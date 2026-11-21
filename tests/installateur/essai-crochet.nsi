; Banc d'essai du crochet NSIS_HOOK_PREINSTALL (src-tauri/windows/hooks.nsh), compilé et lancé par
; crochet-preinstall.mjs. Les macros du modèle d'installateur de Tauri qu'utilise le crochet sont remplacées par
; des versions inertes : aucun processus n'est arrêté, aucun raccourci n'est examiné.
;
; Définitions attendues sur la ligne de commande : ANCIEN_NOM, ANCIEN_EXE (fausse ancienne installation),
; CROCHETS (chemin de hooks.nsh), SORTIE (exécutable produit).

Unicode true
!include LogicLib.nsh
!include FileFunc.nsh

!macro CheckIfAppIsRunning executablePath productName
!macroend
!macro IsShortcutTarget lnk target
  Push 0
!macroend
!macro UnpinShortcut lnk
!macroend

!include "${CROCHETS}"

Name "Essai du crochet"
OutFile "${SORTIE}"
RequestExecutionLevel user
SilentInstall silent
InstallDir "$TEMP\entites-dossiers-crochet-instdir"

Section
  !insertmacro NSIS_HOOK_PREINSTALL
SectionEnd
