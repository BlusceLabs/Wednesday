; NSIS installer script template for Wednesday on Windows.
;
; This is a starting point, not a signed installer: producing a real .exe
; requires running `makensis` on a Windows machine (or with Wine) with the
; NSIS toolchain installed, and code-signing it separately with a real
; certificate. Neither step can be completed from this environment.

!define APP_NAME "Wednesday"
!define APP_VERSION "1.0.0-rc.6"
!define APP_PUBLISHER "Midknight Mantra"
!define APP_EXE "wednesday.cmd"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "wednesday-${APP_VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Wednesday"
RequestExecutionLevel user

Page directory
Page instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\..\src"
  File "..\..\package.json"
  File "..\..\tsconfig.json"
  FileOpen $0 "$INSTDIR\${APP_EXE}" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "cd %~dp0$\r$\n"
  FileWrite $0 "bun run src\index.tsx %*$\r$\n"
  FileClose $0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\src"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  RMDir "$INSTDIR"
SectionEnd
