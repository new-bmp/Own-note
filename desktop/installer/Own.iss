#ifndef PackageDir
  #error PackageDir must point to the completed Own desktop package.
#endif
#ifndef OutputDir
  #error OutputDir is required.
#endif
#ifndef AppVersion
  #error AppVersion is required.
#endif

#ifdef InstallerTest
  #define OwnId "Own.Notes.InstallerTest"
  #define OwnName "Own 安装验收"
  #define OwnOutput "Own-Setup-test"
#else
  #define OwnId "Own.Notes"
  #define OwnName "Own"
  #define OwnOutput "Own-Setup"
#endif

[Setup]
AppId={#OwnId}
AppName={#OwnName}
AppVersion={#AppVersion}
AppPublisher=Own
VersionInfoDescription=Own 自由画布笔记安装程序
VersionInfoProductName=Own
VersionInfoVersion={#AppVersion}.0
DefaultDirName={localappdata}\Programs\{#OwnName}
DefaultGroupName={#OwnName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
WizardStyle=modern
SetupIconFile=..\own.ico
UninstallDisplayName={#OwnName}
UninstallDisplayIcon={app}\Own.exe
AppMutex=Local\{#OwnId}.Running
SetupMutex=Local\{#OwnId}.Setup
#ifdef InstallerTest
CloseApplications=no
#else
CloseApplications=yes
#endif
CloseApplicationsFilter=Own.exe
RestartApplications=no
OutputDir={#OutputDir}
OutputBaseFilename={#OwnOutput}
Compression=lzma2/fast
SolidCompression=yes
SetupLogging=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce

[Files]
; Only the completed production package is included. User notes live outside
; {app}; neither installation nor uninstallation touches that data directory.
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#OwnName}"; Filename: "{app}\Own.exe"; WorkingDir: "{app}"; AppUserModelID: "{#OwnId}"
Name: "{autodesktop}\{#OwnName}"; Filename: "{app}\Own.exe"; WorkingDir: "{app}"; AppUserModelID: "{#OwnId}"; Tasks: desktopicon

[Run]
Filename: "{app}\Own.exe"; Description: "启动 Own"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
