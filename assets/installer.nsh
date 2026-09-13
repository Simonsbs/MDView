; Always install for the current user, without administrator elevation.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend

!macro customInstall
  ; Keep the former fallback for uninstall. Windows UserChoice is left to Windows.
  ReadRegStr $0 HKCU "Software\Classes\.md" ""
  ${If} $0 != "MDView.Markdown"
    WriteRegStr HKCU "Software\MDView" "PreviousMdProgId" "$0"
  ${EndIf}
  WriteRegStr HKCU "Software\Classes\.md" "" "MDView.Markdown"
  WriteRegNone HKCU "Software\Classes\.md\OpenWithProgids" "MDView.Markdown"
  WriteRegStr HKCU "Software\Classes\MDView.Markdown" "" "Markdown document"
  WriteRegStr HKCU "Software\Classes\MDView.Markdown\DefaultIcon" "" '"$INSTDIR\MDView.exe",0'
  WriteRegStr HKCU "Software\Classes\MDView.Markdown\shell\open\command" "" '"$INSTDIR\MDView.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\MDView.exe" "FriendlyAppName" "MDView"
  WriteRegStr HKCU "Software\Classes\Applications\MDView.exe\shell\open\command" "" '"$INSTDIR\MDView.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\MDView.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\MDView\Capabilities" "ApplicationName" "MDView"
  WriteRegStr HKCU "Software\MDView\Capabilities" "ApplicationDescription" "Read Markdown files with automatic refresh."
  WriteRegStr HKCU "Software\MDView\Capabilities" "ApplicationIcon" '"$INSTDIR\MDView.exe",0'
  WriteRegStr HKCU "Software\MDView\Capabilities\FileAssociations" ".md" "MDView.Markdown"
  WriteRegStr HKCU "Software\RegisteredApplications" "MDView" "Software\MDView\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\.md" ""
  ${If} $0 == "MDView.Markdown"
    ReadRegStr $1 HKCU "Software\MDView" "PreviousMdProgId"
    ${If} $1 == ""
      DeleteRegValue HKCU "Software\Classes\.md" ""
    ${Else}
      WriteRegStr HKCU "Software\Classes\.md" "" "$1"
    ${EndIf}
  ${EndIf}
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "MDView.Markdown"
  DeleteRegKey HKCU "Software\Classes\MDView.Markdown"
  DeleteRegKey HKCU "Software\Classes\Applications\MDView.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "MDView"
  DeleteRegKey HKCU "Software\MDView"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customFinishPage
  Function StartMDView
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\MDView.exe" "open" "--make-default"
  FunctionEnd
  !define MUI_FINISHPAGE_TEXT "MDView is installed and registered for .md files.$\r$\n$\r$\nWindows may ask you to confirm MDView as the default. Select MDView for .md in the Default apps settings that open next."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open MDView and set the .md default"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartMDView"
  !insertmacro MUI_PAGE_FINISH
!macroend
