"""Build the numpy Lambda layer with Linux wheels, from any OS (no Docker).

    python infra/build_layer.py
Creates build/numpy-layer/python/numpy..., which template.yaml uses.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "build" / "numpy-layer" / "python"

if TARGET.exists():
    shutil.rmtree(TARGET)
TARGET.mkdir(parents=True)
subprocess.check_call([
    sys.executable, "-m", "pip", "install", "numpy==2.2.6",
    "--platform", "manylinux2014_x86_64", "--implementation", "cp",
    "--python-version", "3.12", "--only-binary=:all:", "--target", str(TARGET),
])
print(f"Layer ready: {TARGET.parent}")
