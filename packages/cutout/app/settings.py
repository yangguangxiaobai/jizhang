"""One validated source for the inference service's resource and image limits."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


class SettingsError(ValueError):
    """A deployment setting is invalid; fail service startup rather than widen limits."""


def _positive_int(env: Mapping[str, str], name: str, default: int, maximum: int) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise SettingsError(f"{name} must be an integer.") from error
    if value < 1 or value > maximum:
        raise SettingsError(f"{name} must be between 1 and {maximum}.")
    return value


@dataclass(frozen=True)
class Settings:
    checkpoint: Path
    model_config: str
    temp_dir: Path
    max_input_bytes: int = 2 * 1024 * 1024
    max_source_pixels: int = 40_000_000
    max_edge: int = 1600
    max_candidates: int = 8
    max_live_jobs: int = 2
    max_retained_jobs: int = 3
    job_ttl_seconds: int = 600
    job_timeout_seconds: int = 120
    points_per_side: int = 8
    points_per_batch: int = 8
    pred_iou_threshold: float = 0.80
    stability_threshold: float = 0.90
    min_area_ratio: float = 0.002
    max_area_ratio: float = 0.94
    max_candidate_bytes: int = 16 * 1024 * 1024
    max_preview_bytes: int = 2 * 1024 * 1024
    max_total_output_bytes: int = 128 * 1024 * 1024

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        source = os.environ if env is None else env
        checkpoint = Path(
            source.get("JIZHANG_CUTOUT_CHECKPOINT", "/opt/models/sam2.1_hiera_small.pt")
        )
        temp_dir = Path(source.get("JIZHANG_CUTOUT_TMP_DIR", "/tmp/jizhang-cutout-jobs"))
        model_config = source.get(
            "JIZHANG_CUTOUT_CONFIG", "configs/sam2.1/sam2.1_hiera_s.yaml"
        ).strip()
        if model_config == "":
            raise SettingsError("JIZHANG_CUTOUT_CONFIG must not be empty.")
        return cls(
            checkpoint=checkpoint,
            model_config=model_config,
            temp_dir=temp_dir,
            max_input_bytes=_positive_int(
                source, "JIZHANG_CUTOUT_MAX_INPUT_BYTES", 2 * 1024 * 1024, 2 * 1024 * 1024
            ),
            max_source_pixels=_positive_int(
                source, "JIZHANG_CUTOUT_MAX_SOURCE_PIXELS", 40_000_000, 40_000_000
            ),
            max_edge=_positive_int(source, "JIZHANG_CUTOUT_MAX_EDGE", 1600, 1600),
            max_candidates=_positive_int(source, "JIZHANG_CUTOUT_MAX_CANDIDATES", 8, 8),
            max_live_jobs=_positive_int(source, "JIZHANG_CUTOUT_MAX_LIVE_JOBS", 2, 2),
            max_retained_jobs=_positive_int(source, "JIZHANG_CUTOUT_MAX_RETAINED_JOBS", 3, 3),
            job_ttl_seconds=_positive_int(
                source, "JIZHANG_CUTOUT_JOB_TTL_SECONDS", 600, 600
            ),
            job_timeout_seconds=_positive_int(
                source, "JIZHANG_CUTOUT_JOB_TIMEOUT_SECONDS", 120, 120
            ),
            points_per_side=_positive_int(source, "JIZHANG_CUTOUT_POINTS_PER_SIDE", 8, 16),
            points_per_batch=_positive_int(source, "JIZHANG_CUTOUT_POINTS_PER_BATCH", 8, 16),
            max_preview_bytes=_positive_int(
                source,
                "JIZHANG_CUTOUT_MAX_PREVIEW_BYTES",
                2 * 1024 * 1024,
                2 * 1024 * 1024,
            ),
        )
