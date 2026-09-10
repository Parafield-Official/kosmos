#!/usr/bin/env bash
# Invoked on native Intel macOS by both pre-release verification and packaging.
set -euo pipefail
test "$(uname -s)" = Darwin
test "$(uname -m)" = x86_64
cd "$(dirname "$0")/.."
test -f package.json
runtime_tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/kosmos-intel.XXXXXX")"
export MACOSX_DEPLOYMENT_TARGET=15.0
brew install cmake nasm pkg-config lame mpg123
mkdir -p vendor/bin .release-cache/native vendor/whisperx-runtime/whisperx
python -m pip install --upgrade 'markitdown[docx,pdf]==0.1.6' 'pyinstaller==6.22.2' 'pip-licenses==5.5.1'
python -m piplicenses --from=mixed --format=plain-vertical --with-license-file \
  --with-notice-file --no-license-path --output-file vendor/bin/MARKITDOWN_THIRD_PARTY_NOTICES.txt
PYINSTALLER_CONFIG_DIR="$runtime_tmp/pyinstaller" pyinstaller --noconfirm --clean --onefile \
  --collect-data magika --name markitdown --distpath vendor/bin \
  --workpath "$runtime_tmp/markitdown-build" --specpath "$runtime_tmp/markitdown-spec" scripts/markitdown_cli.py
# These optional engines in git are arm64-only. Intel uses the tested CPU
# whisper-cli/server pair built below. Never leave an arm64 helper discoverable.
rm -f vendor/bin/parakeet-live vendor/bin/parakeet-server vendor/bin/libparakeet.dylib

ffmpeg_version=8.1.1
ffmpeg_archive="$PWD/.release-cache/native/FFmpeg-${ffmpeg_version}-source.tar.xz"
curl -fL --retry 3 "https://ffmpeg.org/releases/ffmpeg-${ffmpeg_version}.tar.xz" -o "$ffmpeg_archive"
tar -xf "$ffmpeg_archive" -C "$runtime_tmp"
pushd "$runtime_tmp/ffmpeg-${ffmpeg_version}"
./configure --prefix="$runtime_tmp/ffmpeg-prefix" \
  --disable-gpl --disable-nonfree --disable-debug --disable-doc \
  --disable-shared --enable-static --disable-avdevice --disable-indevs --disable-outdevs \
  --disable-libxcb --disable-libxcb-shm --disable-libxcb-xfixes --disable-libxcb-shape \
  --disable-xlib --disable-appkit --disable-audiotoolbox --disable-videotoolbox \
  --enable-libmp3lame --arch=x86_64 \
  --extra-cflags="-mmacosx-version-min=15.0 -I$(brew --prefix lame)/include" \
  --extra-ldflags="-mmacosx-version-min=15.0 -L$(brew --prefix lame)/lib"
make -j3
make install
popd
cp "$runtime_tmp/ffmpeg-prefix/bin/ffmpeg" vendor/bin/ffmpeg
cp "$runtime_tmp/ffmpeg-prefix/bin/ffprobe" vendor/bin/ffprobe
cp "$(brew --prefix lame)/lib/libmp3lame.0.dylib" vendor/bin/libmp3lame.0.dylib
cp "$(brew --prefix mpg123)/lib/libmpg123.0.dylib" vendor/bin/libmpg123.0.dylib
for executable in vendor/bin/ffmpeg vendor/bin/ffprobe; do
  while IFS= read -r dependency; do
    install_name_tool -change "$dependency" "@loader_path/$(basename "$dependency")" "$executable"
  done < <(otool -L "$executable" | awk '/libmp3lame|libmpg123/ {print $1}')
done
for library in vendor/bin/libmp3lame.0.dylib vendor/bin/libmpg123.0.dylib; do
  install_name_tool -id "@loader_path/$(basename "$library")" "$library"
  while IFS= read -r dependency; do
    install_name_tool -change "$dependency" "@loader_path/$(basename "$dependency")" "$library"
  done < <(otool -L "$library" | awk '/libmp3lame|libmpg123/ {print $1}')
done
cp "$runtime_tmp/ffmpeg-${ffmpeg_version}/COPYING.LGPLv2.1" vendor/bin/LGPL-2.1.txt

whisper_commit=4834a2327d008ace3ec5a9ed00f51454bcabbc1c
git init "$runtime_tmp/whisper.cpp"
git -C "$runtime_tmp/whisper.cpp" remote add origin https://github.com/ggml-org/whisper.cpp.git
git -C "$runtime_tmp/whisper.cpp" fetch --depth 1 origin "$whisper_commit"
git -C "$runtime_tmp/whisper.cpp" checkout --detach FETCH_HEAD
cmake -S "$runtime_tmp/whisper.cpp" -B "$runtime_tmp/whisper-build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
  -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=ON -DGGML_METAL=OFF -DGGML_NATIVE=OFF
cmake --build "$runtime_tmp/whisper-build" --config Release --parallel 3
cp "$runtime_tmp/whisper-build/bin/whisper-cli" vendor/bin/whisper-cli
cp "$runtime_tmp/whisper-build/bin/whisper-server" vendor/bin/whisper-server
cp "$runtime_tmp/whisper.cpp/LICENSE" vendor/bin/WHISPER_LICENSE.txt
node scripts/audit-mac-architecture.cjs vendor/bin x64
node scripts/audit-runtime.cjs
