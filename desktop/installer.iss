#define AppName "ТҮР HR · MPC"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define ReleaseDir "build\windows\x64\runner\Release"

[Setup]
AppId={{2F3AE6A4-40EC-48A1-96AD-DCD359A91B02}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\MPC HR
DefaultGroupName={#AppName}
OutputDir=build\installer
OutputBaseFilename=MPC-HR-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\mpc_hr_desktop.exe
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\mpc_hr_desktop.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\mpc_hr_desktop.exe"

[Run]
Filename: "{app}\mpc_hr_desktop.exe"; Description: "Програмыг нээх"; Flags: nowait postinstall skipifsilent
