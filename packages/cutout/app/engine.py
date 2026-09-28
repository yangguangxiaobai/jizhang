"""CPU-only SAM 2 automatic region proposals and transparent cutout rendering."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

import numpy as np
from PIL import Image, ImageChops, ImageFilter

from .settings import Settings

class CutoutCancelled(Exception):
    """Raised between model stages when a transient job is cancelled."""


@dataclass(frozen=True)
class CandidateFile:
    candidate_id: str
    width: int
    height: int
    preview_path: Path
    image_path: Path


class CutoutEngine(Protocol):
    def generate(
        self,
        source_path: Path,
        output_dir: Path,
        cancelled: threading.Event,
        progress: Callable[[str], None],
    ) -> list[CandidateFile]: ...


class Sam2CutoutEngine:
    """Loads the pinned small SAM 2.1 model once and runs a bounded CPU proposal pass."""

    def __init__(self, settings: Settings) -> None:
        import torch
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        from sam2.build_sam import build_sam2

        if not settings.checkpoint.is_file():
            raise RuntimeError("The configured cutout checkpoint is missing.")

        torch.set_num_threads(2)
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            # PyTorch allows this setting only before parallel work begins.
            pass

        model = build_sam2(
            settings.model_config,
            str(settings.checkpoint),
            device="cpu",
        )
        self._torch = torch
        self._generator = SAM2AutomaticMaskGenerator(
            model,
            points_per_side=settings.points_per_side,
            points_per_batch=settings.points_per_batch,
            pred_iou_thresh=settings.pred_iou_threshold,
            stability_score_thresh=settings.stability_threshold,
            box_nms_thresh=0.7,
            min_mask_region_area=0,
            output_mode="uncompressed_rle",
        )
        self._max_candidates = settings.max_candidates
        self._min_area_ratio = settings.min_area_ratio
        self._max_area_ratio = settings.max_area_ratio
        self._max_candidate_bytes = settings.max_candidate_bytes
        self._max_preview_bytes = settings.max_preview_bytes
        self._max_total_output_bytes = settings.max_total_output_bytes

    def generate(
        self,
        source_path: Path,
        output_dir: Path,
        cancelled: threading.Event,
        progress: Callable[[str], None],
    ) -> list[CandidateFile]:
        from sam2.utils.amg import rle_to_mask

        with Image.open(source_path) as opened:
            original = opened.convert("RGBA")

        # SAM 2 sees RGB; the final alpha mask is multiplied with the source alpha so
        # transparent areas in the user photo never become opaque again.
        rgb = Image.new("RGB", original.size, "white")
        rgb.paste(original, mask=original.getchannel("A"))
        rgb_array = np.asarray(rgb, dtype=np.uint8)
        width, height = rgb.size
        pixel_count = width * height

        if cancelled.is_set():
            original.close()
            rgb.close()
            raise CutoutCancelled()

        progress("正在分析图片并寻找轮廓…")
        with self._torch.inference_mode():
            annotations = self._generator.generate(rgb_array)
        del rgb_array
        rgb.close()

        if cancelled.is_set():
            original.close()
            raise CutoutCancelled()

        # The model returns generic regions, not semantic object detections. Filter
        # near-empty and near-full-frame masks, then rank the remaining candidates.
        ranked: list[tuple[float, int, dict[str, object]]] = []
        for annotation in annotations:
            area_value = annotation.get("area")
            iou_value = annotation.get("predicted_iou")
            stability_value = annotation.get("stability_score")
            if not isinstance(area_value, (int, float)):
                continue
            if not isinstance(iou_value, (int, float)) or not isinstance(
                stability_value, (int, float)
            ):
                continue
            ratio = float(area_value) / pixel_count
            if ratio < self._min_area_ratio or ratio > self._max_area_ratio:
                continue
            score = float(iou_value) * float(stability_value)
            if score < 0.62:
                continue
            ranked.append((score, int(area_value), annotation))
        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)

        candidates: list[CandidateFile] = []
        chosen_masks: list[np.ndarray] = []
        total_output_bytes = 0
        output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        progress("正在整理透明候选…")

        for _score, _area, annotation in ranked:
            if cancelled.is_set():
                original.close()
                raise CutoutCancelled()
            segmentation = annotation.get("segmentation")
            if not isinstance(segmentation, dict):
                continue
            try:
                mask = np.asarray(rle_to_mask(segmentation), dtype=bool)
            except (KeyError, TypeError, ValueError):
                continue
            if mask.shape != (height, width):
                continue
            ys, xs = np.nonzero(mask)
            if xs.size == 0 or ys.size == 0:
                continue

            is_duplicate = False
            for existing in chosen_masks:
                intersection = int(np.logical_and(mask, existing).sum())
                union = int(np.logical_or(mask, existing).sum())
                if union > 0 and intersection / union > 0.90:
                    is_duplicate = True
                    break
            if is_duplicate:
                del mask
                continue

            x0 = max(0, int(xs.min()))
            y0 = max(0, int(ys.min()))
            x1 = min(width, int(xs.max()) + 1)
            y1 = min(height, int(ys.max()) + 1)
            cropped_mask = Image.fromarray(mask[y0:y1, x0:x1].astype(np.uint8) * 255)
            del xs, ys

            rgba = original.crop((x0, y0, x1, y1))
            mask_alpha = cropped_mask.filter(ImageFilter.GaussianBlur(0.35))
            source_alpha = original.getchannel("A").crop((x0, y0, x1, y1))
            alpha = ImageChops.multiply(mask_alpha, source_alpha)
            rgba.putalpha(alpha)
            cropped_mask.close()
            mask_alpha.close()
            source_alpha.close()
            alpha.close()

            # A subtle transparent margin avoids clipping anti-aliased edge pixels.
            padded = Image.new("RGBA", (rgba.width + 12, rgba.height + 12), (0, 0, 0, 0))
            padded.alpha_composite(rgba, (6, 6))
            rgba.close()

            candidate_id = str(len(candidates))
            image_path = output_dir / f"candidate-{candidate_id}.png"
            preview_path = output_dir / f"candidate-{candidate_id}-preview.webp"
            padded.save(image_path, format="PNG", optimize=True)
            if image_path.stat().st_size > self._max_candidate_bytes:
                image_path.unlink(missing_ok=True)
                padded.close()
                continue

            preview = padded.copy()
            preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
            preview.save(preview_path, format="WEBP", lossless=True, method=4)
            preview.close()
            padded.close()

            if preview_path.stat().st_size > self._max_preview_bytes:
                image_path.unlink(missing_ok=True)
                preview_path.unlink(missing_ok=True)
                continue

            output_bytes = image_path.stat().st_size + preview_path.stat().st_size
            if total_output_bytes + output_bytes > self._max_total_output_bytes:
                image_path.unlink(missing_ok=True)
                preview_path.unlink(missing_ok=True)
                break
            total_output_bytes += output_bytes
            candidates.append(
                CandidateFile(
                    candidate_id=candidate_id,
                    width=x1 - x0 + 12,
                    height=y1 - y0 + 12,
                    preview_path=preview_path,
                    image_path=image_path,
                )
            )
            chosen_masks.append(mask)
            if len(candidates) >= self._max_candidates:
                break

        original.close()
        return candidates
