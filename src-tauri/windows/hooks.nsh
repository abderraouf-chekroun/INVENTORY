; Crochets de l'installateur NSIS (tauri.conf.json : bundle.windows.nsis.installerHooks).
;
; ---------------------------------------------------------------------------------------------
; Avant l'installation : reprise de l'ancienne installation « Entités et Dossiers ».
;
; Depuis la version 1.4.1, l'application s'appelle INVENTORY. L'installateur de Tauri range
; l'installation sous le nom du produit (dossier %LOCALAPPDATA%\<nom>, clé de désinstallation
; HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<nom>, raccourcis <nom>.lnk) : sans ce
; crochet, INVENTORY s'installerait à côté d'« Entités et Dossiers », les deux sur les mêmes données
; (l'identifiant fr.entitesdossiers.app, donc le dossier de données, ne change pas).
;
; Si une installation « Entités et Dossiers » est enregistrée (clé de désinstallation dans HKCU, et
; dans HKLM par précaution), on la retire À LA MAIN, sans lancer son uninstall.exe :
;   - raccourcis « Entités et Dossiers.lnk » du menu Démarrer et du bureau, seulement s'ils
;     pointent vers l'ancien exécutable (même contrôle que le désinstalleur de Tauri) ;
;   - deux fichiers nommés : <dossier>\entites-dossiers.exe et <dossier>\uninstall.exe, puis RMDir
;     NON récursif du dossier (il n'est supprimé que s'il est vide) ;
;   - clé de désinstallation, clé Software\Entités et Dossiers\Entités et Dossiers (dossier
;     d'installation mémorisé, langue de l'installateur) et Software\Entités et Dossiers si vide ;
;     valeur de démarrage automatique « Entités et Dossiers » (Run), si elle existe.
;
; Le dossier de l'ancienne installation est lu dans le registre ; sa partie HKCU peut être modifiée par
; n'importe quel programme du compte. Il n'est donc retenu (version 1.8.2) que s'il est un chemin absolu sur un
; lecteur, autre qu'une racine, sans « . » ni « .. » comme composant, sans « : » après la lettre du lecteur, sans
; chemin réseau ni périphérique, ET s'il contient l'ancien exécutable. Sinon aucun fichier ni raccourci n'est
; supprimé : seul l'enregistrement de l'ancienne version (clés de registre de noms fixes) est retiré.
; Essai : tests/installateur/crochet-preinstall.mjs (fausse installation, registre et dossiers temporaires).
;
; Pourquoi pas « uninstall.exe /S » : le désinstalleur de Tauri contient l'instruction
; RmDir /r "$APPDATA\fr.entitesdossiers.app" (et $LOCALAPPDATA\fr.entitesdossiers.app), exécutée
; quand $DeleteAppDataCheckboxState = 1. En mode silencieux la case « Supprimer les données de
; l'application » n'est jamais affichée, donc la variable reste vide et rien n'est supprimé ; mais
; ce désinstalleur est l'ancien binaire installé sur chaque poste (versions 1.0 à 1.4.0, modèles
; NSIS de Tauri différents), que nous ne pouvons pas relire ici, et il efface aussi la liste de
; raccourcis (jump list) de l'identifiant fr.entitesdossiers.app, partagé avec INVENTORY. Le retrait
; manuel ci-dessous ne contient AUCUNE instruction visant %APPDATA% ou %LOCALAPPDATA%\<identifiant> :
; il ne supprime que deux fichiers désignés par leur nom et un dossier vide, il ne peut donc pas
; toucher aux données, où qu'elles soient.
;
; Ancienne application ouverte : même comportement que le modèle de Tauri pour l'application
; courante (macro CheckIfAppIsRunning de utils.nsh) : l'installateur affiche « Entités et Dossiers
; est en cours d'exécution. Cliquez sur OK pour fermer l'application. » ; Annuler arrête
; l'installation sans rien retirer. (En mode /S ou /P, comme pour l'application courante, le modèle
; la ferme sans demander : ces modes sont choisis explicitement par celui qui lance l'installateur.)
; Si l'ancien exécutable ne peut pas être supprimé, l'installation s'arrête avec un message, sans
; retirer l'enregistrement de l'ancienne version (elle reste désinstallable normalement).
;
; Le « é » est écrit ${U+00E9} : le nom reste exact quel que soit l'encodage avec lequel makensis
; lit ce fichier. ANCIEN_NOM et ANCIEN_EXE peuvent être définis avant l'inclusion (essai du crochet
; sur une fausse installation).
!define /ifndef ANCIEN_NOM "Entit${U+00E9}s et Dossiers"
!define /ifndef ANCIEN_EXE "entites-dossiers.exe"
!define ANCIEN_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ANCIEN_NOM}"
!define ANCIEN_MANUKEY "Software\${ANCIEN_NOM}"
!define ANCIEN_MANUPRODUCTKEY "Software\${ANCIEN_NOM}\${ANCIEN_NOM}"

!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9

  ; $R9 : racine examinée (HKCU, puis HKLM).
  StrCpy $R9 "HKCU"
  inventory_ancienne_racine:
  ${If} $R9 == "HKCU"
    ReadRegStr $R5 HKCU "${ANCIEN_UNINSTKEY}" "UninstallString"
    ReadRegStr $R6 HKCU "${ANCIEN_UNINSTKEY}" "DisplayName"
    ReadRegStr $R4 HKCU "${ANCIEN_UNINSTKEY}" "InstallLocation"
    ReadRegStr $R8 HKCU "${ANCIEN_MANUPRODUCTKEY}" ""
  ${Else}
    ReadRegStr $R5 HKLM "${ANCIEN_UNINSTKEY}" "UninstallString"
    ReadRegStr $R6 HKLM "${ANCIEN_UNINSTKEY}" "DisplayName"
    ReadRegStr $R4 HKLM "${ANCIEN_UNINSTKEY}" "InstallLocation"
    ReadRegStr $R8 HKLM "${ANCIEN_MANUPRODUCTKEY}" ""
  ${EndIf}
  StrCmp "$R5$R6$R4" "" inventory_ancienne_suivante

  ; Dossier de l'ancienne installation : InstallLocation (entre guillemets), sinon le dossier de
  ; UninstallString, sinon celui mémorisé dans Software\Entités et Dossiers\Entités et Dossiers.
  StrCpy $R7 $R4 1
  ${If} $R7 == '"'
    StrCpy $R4 $R4 -1 1
  ${EndIf}
  ${If} $R4 == ""
  ${AndIf} $R5 != ""
    StrCpy $R7 $R5 1
    ${If} $R7 == '"'
      StrCpy $R5 $R5 -1 1
    ${EndIf}
    ${GetParent} "$R5" $R4
  ${EndIf}
  ${If} $R4 == ""
    StrCpy $R4 $R8
  ${EndIf}

  ; Contrôle du dossier lu dans le registre (la partie HKCU est modifiable par tout programme du compte) :
  ; seul un chemin absolu sur un lecteur (X:\dossier…), qui n'est pas une racine, sans « .. », sans « : » après
  ; la lettre du lecteur (flux de données), ni chemin réseau (\\serveur\…) ou périphérique (\\?\…, \\.\…) est retenu.
  ; Sinon, aucun fichier n'est touché (seul l'enregistrement de l'ancienne version est retiré).
  StrCpy $0 $R4 1 -1
  ${If} $0 == "\"
    StrCpy $R4 $R4 -1
  ${EndIf}
  ${If} $R4 != ""
    StrLen $2 $R4
    StrCpy $0 $R4 1
    StrCpy $1 $R4 2 1
    ${If} $2 < 4
    ${OrIf} $1 != ":\"
    ${OrIf} $0 S< "A"
    ${OrIf} $0 S> "Z"
      StrCpy $3 "refuse"
    ${Else}
      StrCpy $3 ""
      IntOp $2 $2 - 1
      ${For} $1 2 $2
        StrCpy $0 $R4 1 $1
        ${If} $0 == ":"
          StrCpy $3 "refuse"
        ${EndIf}
        StrCpy $0 $R4 4 $1
        ${If} $0 == "\..\"
          StrCpy $3 "refuse"
        ${EndIf}
        StrCpy $0 $R4 3 $1
        ${If} $0 == "\.\"
          StrCpy $3 "refuse"
        ${EndIf}
      ${Next}
      StrCpy $0 $R4 3 -3
      ${If} $0 == "\.."
        StrCpy $3 "refuse"
      ${EndIf}
      StrCpy $0 $R4 2 -2
      ${If} $0 == "\."
        StrCpy $3 "refuse"
      ${EndIf}
    ${EndIf}
    ${If} $3 == "refuse"
      DetailPrint "Ancienne installation « ${ANCIEN_NOM} » ($R9) : dossier enregistré refusé ($R4), aucun fichier n'est supprimé."
      StrCpy $R4 ""
    ${EndIf}
  ${EndIf}
  ; Le dossier doit contenir l'ancien exécutable : sinon ce n'est pas (ou plus) l'ancienne installation, et
  ; ni son uninstall.exe ni le dossier ne sont touchés.
  ${If} $R4 != ""
  ${AndIfNot} ${FileExists} "$R4\${ANCIEN_EXE}"
    DetailPrint "Ancienne installation « ${ANCIEN_NOM} » ($R9) : ${ANCIEN_EXE} absent de $R4, aucun fichier n'est supprimé."
    StrCpy $R4 ""
  ${EndIf}
  DetailPrint "Ancienne installation « ${ANCIEN_NOM} » ($R9) : $R4"

  ${If} $R4 != ""
  ${AndIf} ${FileExists} "$R4\${ANCIEN_EXE}"
    !insertmacro CheckIfAppIsRunning "$R4\${ANCIEN_EXE}" "${ANCIEN_NOM}"
  ${EndIf}

  ; Raccourcis (installation pour tous les utilisateurs : ceux de « Tous les utilisateurs »).
  ${If} $R9 == "HKLM"
    SetShellVarContext all
  ${EndIf}
  ${If} $R4 != ""
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${ANCIEN_NOM}.lnk" "$R4\${ANCIEN_EXE}"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${ANCIEN_NOM}.lnk"
      Delete "$SMPROGRAMS\${ANCIEN_NOM}.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$DESKTOP\${ANCIEN_NOM}.lnk" "$R4\${ANCIEN_EXE}"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${ANCIEN_NOM}.lnk"
      Delete "$DESKTOP\${ANCIEN_NOM}.lnk"
    ${EndIf}
  ${EndIf}
  SetShellVarContext current

  ; Programme : deux fichiers désignés par leur nom, puis le dossier s'il est vide.
  ${If} $R4 != ""
    Delete "$R4\${ANCIEN_EXE}"
    ${If} ${FileExists} "$R4\${ANCIEN_EXE}"
      DetailPrint "Impossible de supprimer $R4\${ANCIEN_EXE}."
      MessageBox MB_ICONSTOP "L'ancienne version « ${ANCIEN_NOM} » ($R4) n'a pas pu être retirée.$\nDésinstallez-la depuis Paramètres > Applications, puis relancez l'installation.$\nVos données ne sont pas concernées." /SD IDOK
      Abort "L'ancienne version « ${ANCIEN_NOM} » ($R4) n'a pas pu être retirée. Désinstallez-la depuis Paramètres > Applications, puis relancez l'installation. Vos données ne sont pas concernées."
    ${EndIf}
    Delete "$R4\uninstall.exe"
    ${If} $R4 != $INSTDIR
      RMDir "$R4"
    ${EndIf}
  ${EndIf}

  ; Enregistrement de l'ancienne version.
  ${If} $R9 == "HKCU"
    DeleteRegKey HKCU "${ANCIEN_UNINSTKEY}"
    DeleteRegKey HKCU "${ANCIEN_MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${ANCIEN_MANUKEY}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${ANCIEN_NOM}"
  ${Else}
    DeleteRegKey HKLM "${ANCIEN_UNINSTKEY}"
    DeleteRegKey HKLM "${ANCIEN_MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKLM "${ANCIEN_MANUKEY}"
  ${EndIf}
  DetailPrint "Ancienne installation « ${ANCIEN_NOM} » retirée ; données de l'application conservées."

  inventory_ancienne_suivante:
  ${If} $R9 == "HKCU"
    StrCpy $R9 "HKLM"
    Goto inventory_ancienne_racine
  ${EndIf}

  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; ---------------------------------------------------------------------------------------------
; Après l'installation : droits du dossier d'installation.
;
; Installation hors du profil de l'utilisateur (par exemple C:\Applications\INVENTORY) :
; le dossier hériterait des droits de son parent, souvent modifiables par tous les utilisateurs
; authentifiés (un autre compte pourrait y déposer une DLL). On coupe alors l'héritage et on ne
; garde que trois ayants droit, désignés par SID (indépendant de la langue de Windows) :
;   - l'utilisateur qui installe (SID lu dans le jeton du processus d'installation) ;
;   - SYSTEM (S-1-5-18) ;
;   - Administrateurs (S-1-5-32-544).
; Installation dans le profil (cas par défaut : %LOCALAPPDATA%) : rien n'est modifié.
; Si le SID de l'utilisateur ne peut pas être lu, rien n'est modifié non plus (on ne retire jamais
; ses propres droits à l'utilisateur).

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6

  ; $INSTDIR est-il dans $PROFILE ? (StrCmp ne tient pas compte de la casse)
  StrCpy $6 "$PROFILE\"
  StrLen $0 $6
  StrCpy $1 "$INSTDIR\" $0
  StrCmp $1 $6 entites_acl_fin 0

  ; SID de l'utilisateur courant : OpenProcessToken + GetTokenInformation(TokenUser) + ConvertSidToStringSidW.
  StrCpy $5 ""
  System::Call 'advapi32::OpenProcessToken(p -1, i 0x8, *p .r1) i .r0'
  IntCmp $0 0 entites_acl_sans_sid
  System::Call 'advapi32::GetTokenInformation(p r1, i 1, p 0, i 0, *i .r2) i .r0'
  System::Alloc $2
  Pop $3
  System::Call 'advapi32::GetTokenInformation(p r1, i 1, p r3, i r2, *i .r2) i .r0'
  IntCmp $0 0 entites_acl_liberer
  System::Call '*$3(p .r4)'
  System::Call 'advapi32::ConvertSidToStringSidW(p r4, *p .r4) i .r0'
  IntCmp $0 0 entites_acl_liberer
  System::Call '*$4(&w256 .r5)'
  System::Call 'kernel32::LocalFree(p r4)'
  entites_acl_liberer:
  System::Free $3
  System::Call 'kernel32::CloseHandle(p r1)'
  entites_acl_sans_sid:

  StrCpy $0 $5 4
  StrCmp $0 "S-1-" 0 entites_acl_fin
  DetailPrint "Restriction des droits du dossier d'installation (hors du profil utilisateur)."
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /inheritance:r /grant:r "*$5:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /C /Q'
  Pop $0
  ; Les fichiers déjà copiés reprennent les droits hérités du dossier.
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\*" /reset /T /C /Q'
  Pop $0

  entites_acl_fin:
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
