# Third-party software notices

The image-cutout service uses the following components. Direct dependency versions are pinned
in `requirements.txt` and `Dockerfile`. The table records the Python distributions resolved in
the local Linux runtime image built on 2026-09-28; refresh it after any dependency update.

- Meta SAM 2.1 code and checkpoints: Apache License 2.0. The upstream `LICENSE_cctorch` file
  is BSD 3-Clause and is preserved separately in the image. Source and checkpoint provenance:
  [facebookresearch/sam2](https://github.com/facebookresearch/sam2).
- SAM-2 Python distribution `1.0` is Apache License 2.0. Its upstream `LICENSE_cctorch` is
  BSD 3-Clause; the Docker image preserves both license files under `/opt/licenses`.
- PyTorch `2.9.1+cpu` is BSD-3-Clause; TorchVision `0.24.1+cpu` is BSD. Both wheels contain
  their license files. Their bundled third-party notices, plus the Debian base-image packages,
  still require an image-level SBOM/license review before public redistribution.

### Resolved runtime Python distributions

| Distribution | Version | License |
|---|---:|---|
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| antlr4-python3-runtime | 4.9.3 | BSD |
| anyio | 4.15.1 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| FastAPI | 0.141.1 | MIT |
| filelock | 3.32.3 | MIT |
| fsspec | 2026.7.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| Hydra Core | 1.3.7 | MIT |
| idna | 3.20 | BSD-3-Clause |
| iopath | 0.1.10 | MIT |
| Jinja2 | 3.1.6 | BSD |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| mpmath | 1.3.0 | BSD |
| NetworkX | 3.6.1 | BSD-3-Clause |
| NumPy | 2.5.3 | BSD-3-Clause, 0BSD, MIT, Zlib, CC0-1.0 |
| OmegaConf | 2.3.1 | BSD 3-Clause |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| Pillow | 12.3.0 | MIT-CMU |
| pip | 25.0.1 | MIT |
| portalocker | 4.4.0 | BSD-3-Clause |
| Pydantic | 2.13.5 | MIT |
| pydantic-core | 2.46.5 | MIT |
| PyYAML | 6.0.3 | MIT |
| setuptools | 78.1.0 | MIT |
| Starlette | 1.7.0 | BSD-3-Clause |
| SymPy | 1.14.0 | BSD |
| tqdm | 4.67.1 | MPL-2.0 AND MIT |
| typing-inspection | 0.4.4 | MIT |
| typing-extensions | 4.16.0 | PSF-2.0 |
| Uvicorn | 0.53.0 | BSD-3-Clause |

The build-only test target additionally installs HTTPX2 `2.13.1` (BSD-3-Clause), HTTPCore2
`2.13.1` (BSD-3-Clause), pytest `9.0.2` (MIT), iniconfig `2.3.0` (MIT), pluggy `1.6.0`
(MIT), Pygments `2.21.0` (BSD-2-Clause), and truststore `0.10.4` (MIT). These are not installed
in the runtime image.

The local Docker Scout scan indexed 227 package entries. All 116 Debian packages in the image
have their `/usr/share/doc/*/copyright` file present. Scout also identifies a `my-test-package`
entry from setuptools' bundled `pkg_resources/tests/data` fixture; it is not an installed
runtime distribution. Manually review the Debian package licenses and bundled PyTorch NOTICE
before redistributing the image.

This service does not include the supplied AGPL-3.0 application or Ultralytics YOLO code or
weights. The service intentionally returns unlabeled mask candidates; semantic recognition is
not part of this release.
