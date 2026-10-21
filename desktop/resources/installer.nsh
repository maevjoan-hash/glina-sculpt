; Glina NSIS installer additions (included by electron-builder before its own script).

; Install for the current user only: no administrator rights and no "for all users" page.
; The folder can still be chosen (nsis.allowToChangeInstallationDirectory in package.json).
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; NSIS 3.0.4's Bulgarian.nsh has no texts for the "for which users" page. electron-builder treats the
; resulting "missing LangString" warning as an error, so the Bulgarian texts are given here.
!define MULTIUSER_TEXT_INSTALLMODE_TITLE "Избор на потребители"
!define MULTIUSER_TEXT_INSTALLMODE_SUBTITLE "Изберете за кои потребители да се инсталира $(^NameDA)."
!define MULTIUSER_INNERTEXT_INSTALLMODE_TOP "Изберете дали да инсталирате $(^NameDA) само за себе си или за всички потребители на този компютър. $(^ClickNext)"
!define MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS "Инсталиране за всички потребители на компютъра"
!define MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER "Инсталиране само за мен"
