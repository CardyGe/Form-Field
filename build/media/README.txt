Form & Field media tools

FFmpeg 6.1.1 is built from the included official source under LGPL 2.1-or-later, with no GPL or nonfree components. zimg 3.0.6 and Snappy 1.2.1 (used for HAP encoding) are statically linked under their included permissive licenses. pkgconf is used only during compilation.

Complete source archives, the build recipe, checksums, configuration and licenses are included. Rebuild on Apple Silicon macOS with Node.js, Xcode command-line tools and CMake: node scripts/build-media-tools.mjs from the project checkout. No globally installed FFmpeg or third-party shared libraries are required at runtime.
