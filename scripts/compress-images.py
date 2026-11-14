"""Compress repository photos in place and refresh their stable cache version."""

import argparse
import hashlib
import io
import os
from pathlib import Path
import re
import tempfile

from PIL import Image, ImageOps, PngImagePlugin

MINIMUM_BYTES = 500_000
MAXIMUM_SIZE = (1280, 1280)
COMPRESSION_MARKER = "trikonic-images-v1"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def compress_photo(path):
    original_size = path.stat().st_size
    if original_size <= MINIMUM_BYTES:
        return 0

    with Image.open(path) as source:
        image_format = source.format
        if image_format not in {"JPEG", "PNG", "WEBP"} or getattr(source, "n_frames", 1) > 1:
            return 0
        if source.info.get("trikonic_compressed") == COMPRESSION_MARKER:
            return 0
        if source.info.get("comment") == COMPRESSION_MARKER.encode():
            return 0
        if source.getexif().get(305) == COMPRESSION_MARKER:
            return 0
        # Earlier catalog compression already produced these palette PNGs.
        if image_format == "PNG" and source.mode == "P" and max(source.size) <= 1280:
            return 0

        image = ImageOps.exif_transpose(source)
        image.thumbnail(MAXIMUM_SIZE, Image.Resampling.LANCZOS)
        options = {"icc_profile": source.info.get("icc_profile")}
        if image_format == "JPEG":
            image = image.convert("RGB")
            options.update(quality=82, optimize=True, progressive=True,
                           comment=COMPRESSION_MARKER.encode())
        elif image_format == "PNG":
            if "A" in image.getbands() or "transparency" in source.info:
                image = image.convert("RGBA")
            else:
                image = image.convert("RGB").quantize(
                    colors=256, method=Image.Quantize.MEDIANCUT,
                    dither=Image.Dither.FLOYDSTEINBERG,
                )
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text("trikonic_compressed", COMPRESSION_MARKER)
            options.update(optimize=True, pnginfo=metadata)
        else:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            metadata = Image.Exif()
            metadata[305] = COMPRESSION_MARKER
            options.update(quality=82, method=6, exif=metadata.tobytes())

        output = io.BytesIO()
        image.save(output, format=image_format, **options)
        compressed = output.getvalue()

    if len(compressed) >= original_size:
        return 0
    # Replace a photo only after its complete encoded output is available.
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(compressed)
        temporary_path = Path(temporary.name)
    try:
        temporary_path.chmod(path.stat().st_mode & 0o777)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return original_size - len(compressed)


def refresh_cache_version(root, photos):
    digest = hashlib.sha256()
    for photo in photos:
        digest.update(photo.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(photo.read_bytes()).digest())
    version = "images-" + digest.hexdigest()[:16]
    app = root / "app.js"
    source = app.read_text()
    updated, replacements = re.subn(
        r'const catalogImageVersion = [^;]+;',
        f'const catalogImageVersion = "{version}";', source,
    )
    if replacements != 1:
        raise ValueError("Expected one catalogImageVersion declaration in app.js")
    if updated != source:
        app.write_text(updated)
    for page in root.glob("*.html"):
        source = page.read_text()
        updated = re.sub(r'src="app\.js(?:\?[^\"]*)?"',
                         f'src="app.js?v={version}"', source)
        if updated != source:
            page.write_text(updated)
    return version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    root = parser.parse_args().root.resolve()
    photos = sorted(path for path in (root / "images").rglob("*")
                    if path.is_file() and not path.is_symlink()
                    and path.suffix.lower() in PHOTO_EXTENSIONS)
    savings = [compress_photo(photo) for photo in photos]
    version = refresh_cache_version(root, photos)
    print(f"Compressed {sum(saved > 0 for saved in savings)} photos, "
          f"saved {sum(savings) / 1_000_000:.2f} MB. Cache version {version}.")


if __name__ == "__main__":
    main()
