# MPC HR Flutter client

This Flutter client runs on Windows, macOS, Linux, Android, iOS, and Web. It opens the existing MPC HR web application, so the same pages, API calls, and account permissions are used. The configured server address is saved on the device. It opens the production site by default; set `APP_URL` at build time to use a different server.

## Run locally

From this directory:

```sh
cd desktop
flutter pub get
flutter run -d macos       # or windows, linux, android, ios, chrome
```

Select the matching device in VS Code when running the app there. Each target needs its platform toolchain: Xcode and CocoaPods for macOS/iOS, Android SDK for Android, Visual Studio 2022 with the C++ workload and WebView2 Runtime for Windows, and GTK/WPE WebKit 2.0 for Linux. Linux support in the embedded webview package currently uses a beta release. Web uses an iframe; the HR server must allow embedding, and browser cross-site cookie and file access restrictions can affect sign-in and uploads.

On macOS, `desktop/macos/Podfile` is included. If CocoaPods cannot write its cache, check the macOS account's permissions for the CocoaPods cache, then run `flutter pub get` and try again.

## Build Windows installer

Run on Windows after installing Flutter 3.47+, Visual Studio 2022 Desktop development with C++, NuGet CLI, and Inno Setup 6. The production address `https://mpc-hr.vercel.app` is prefilled. Set `MPC_HR_URL` only when building for another server:

```powershell
# Optional server override:
# $env:MPC_HR_URL = "https://your-project.vercel.app"
./build_windows.ps1 -Version "1.0.8"
```

The ZIP at `build/installer/MPC-HR-1.0.8-Windows.zip` contains `MPC-HR-Setup.exe`. Upload that ZIP in the web app's admin **Windows program** page. The installer adds Desktop and Start menu shortcuts. A Windows `.exe` build must be produced on Windows.
