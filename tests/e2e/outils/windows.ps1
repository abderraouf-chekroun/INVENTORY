# Pilotage de Windows pour la suite de bout en bout : fenêtres de l'application (état, premier plan,
# fermeture), boîtes de dialogue natives (sélecteur de fichier, message d'erreur), vraie souris et vrai clavier.
#
# Serveur : une requête par ligne sur l'entrée standard, une réponse par ligne sur la sortie standard,
# toutes deux en JSON encodé en base64 (UTF-8), pour transporter n'importe quel chemin sans souci d'encodage.
#   requête  : {"cmd": "...", "args": [...]}
#   réponse  : {"ok": true, "valeur": ...} ou {"ok": false, "erreur": "..."}
#
# Garde-fou : le clavier et la souris n'agissent que si la fenêtre visée est au premier plan
# (vérifié juste avant le geste) ; sinon la commande échoue sans rien envoyer.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class E2eWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfoW(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);

  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint t, ref GUITHREADINFO i);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);

  /** Donne le focus clavier à un contrôle d'une autre application (entrée de son fil attachée) ; vrai si c'est fait. */
  public static bool FocusControle(IntPtr controle) {
    uint pid; uint cible = GetWindowThreadProcessId(controle, out pid);
    uint moi = GetCurrentThreadId();
    bool attache = AttachThreadInput(moi, cible, true);
    SetFocus(controle);
    if (attache) AttachThreadInput(moi, cible, false);
    var info = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
    for (int i = 0; i < 20; i++) {
      if (GetGUIThreadInfo(cible, ref info) && info.hwndFocus == controle) return true;
      Thread.Sleep(25);
    }
    return false;
  }

  /** Texte d'un contrôle d'édition (WM_GETTEXT). */
  public static string TexteControle(IntPtr h) {
    int n = SendMessageW(h, 0x000E, IntPtr.Zero, IntPtr.Zero).ToInt32();
    var s = new StringBuilder(n + 1);
    SendMessageW(h, 0x000D, new IntPtr(n + 1), s);
    return s.ToString();
  }

  public static void InitDpi() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  public class Fen { public long hwnd; public string titre; public string classe; public bool visible; public long proprietaire; }

  public static List<Fen> Fenetres(uint pid) {
    var res = new List<Fen>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) {
        var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
        var c = new StringBuilder(256); GetClassNameW(h, c, 256);
        res.Add(new Fen { hwnd = h.ToInt64(), titre = t.ToString(), classe = c.ToString(),
          visible = IsWindowVisible(h), proprietaire = GetWindow(h, 4).ToInt64() });
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }

  /** Met la fenêtre au premier plan ; vrai si elle l'est effectivement. */
  public static bool PremierPlan(IntPtr h) {
    if (GetForegroundWindow() == h) return true;
    IntPtr fg = GetForegroundWindow();
    uint pidFg; uint tFg = GetWindowThreadProcessId(fg, out pidFg);
    uint moi = GetCurrentThreadId();
    bool attache = tFg != 0 && tFg != moi && AttachThreadInput(moi, tFg, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attache) AttachThreadInput(moi, tFg, false);
    for (int i = 0; i < 20 && GetForegroundWindow() != h; i++) {
      if (i == 5) { keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(h); }
      Thread.Sleep(50);
    }
    return GetForegroundWindow() == h;
  }

  static void Envoyer(INPUT[] t) {
    if (SendInput((uint)t.Length, t, Marshal.SizeOf(typeof(INPUT))) != t.Length) throw new Exception("SendInput a échoué.");
  }

  static INPUT Touche(ushort vk, ushort scan, uint flags) {
    var i = new INPUT { type = 1 };
    i.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
    return i;
  }

  /** Tape un texte (caractères Unicode), la fenêtre `h` devant rester au premier plan. */
  public static void Taper(IntPtr h, string texte) {
    foreach (char c in texte) {
      if (GetForegroundWindow() != h) throw new Exception("La fenêtre visée n'est plus au premier plan : frappe interrompue.");
      Envoyer(new[] { Touche(0, c, 4), Touche(0, c, 4 | 2) });
      Thread.Sleep(5);
    }
  }

  public static void ToucheVirtuelle(IntPtr h, ushort vk) {
    if (GetForegroundWindow() != h) throw new Exception("La fenêtre visée n'est pas au premier plan : touche non envoyée.");
    Envoyer(new[] { Touche(vk, 0, 0), Touche(vk, 0, 2) });
  }

  /** Ctrl + touche (ex. Ctrl+A), la fenêtre `h` devant être au premier plan. */
  public static void Ctrl(IntPtr h, ushort vk) {
    if (GetForegroundWindow() != h) throw new Exception("La fenêtre visée n'est pas au premier plan : raccourci non envoyé.");
    Envoyer(new[] { Touche(0x11, 0, 0), Touche(vk, 0, 0), Touche(vk, 0, 2), Touche(0x11, 0, 2) });
  }

  static void Souris(uint flags) {
    var i = new INPUT { type = 0 };
    i.u.mi = new MOUSEINPUT { dwFlags = flags };
    Envoyer(new[] { i });
  }

  /** Glisser-déposer avec la vraie souris (coordonnées physiques de l'écran). */
  public static void Glisser(IntPtr h, int x1, int y1, int x2, int y2) {
    if (GetForegroundWindow() != h) throw new Exception("La fenêtre visée n'est pas au premier plan : glisser annulé.");
    SetCursorPos(x1, y1); Thread.Sleep(150);
    Souris(0x0002); Thread.Sleep(150);
    for (int i = 1; i <= 25; i++) { SetCursorPos(x1 + (x2 - x1) * i / 25, y1 + (y2 - y1) * i / 25); Thread.Sleep(25); }
    Thread.Sleep(200);
    Souris(0x0004); Thread.Sleep(200);
  }
}
'@
[E2eWin]::InitDpi()

function Get-Rect($r) { @{ x = $r.Left; y = $r.Top; l = $r.Right - $r.Left; h = $r.Bottom - $r.Top } }

function Get-FenetrePrincipale([uint32]$processus, [string]$titre) {
  $f = [E2eWin]::Fenetres($processus) | Where-Object { $_.visible -and $_.proprietaire -eq 0 -and $_.titre -eq $titre } | Select-Object -First 1
  if (-not $f) { throw "Fenêtre « $titre » introuvable pour le processus $processus." }
  return [IntPtr]$f.hwnd
}

function Get-EtatFenetre([IntPtr]$h) {
  $r = New-Object E2eWin+RECT; [void][E2eWin]::GetWindowRect($h, [ref]$r)
  $c = New-Object E2eWin+RECT; [void][E2eWin]::GetClientRect($h, [ref]$c)
  $o = New-Object E2eWin+POINT; [void][E2eWin]::ClientToScreen($h, [ref]$o)
  $mi = New-Object E2eWin+MONITORINFO; $mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($mi)
  [void][E2eWin]::GetMonitorInfoW([E2eWin]::MonitorFromWindow($h, 2), [ref]$mi)
  @{
    hwnd = $h.ToInt64()
    exterieur = Get-Rect $r
    client = @{ x = $o.X; y = $o.Y; l = $c.Right; h = $c.Bottom }
    dpi = [E2eWin]::GetDpiForWindow($h)
    agrandie = [E2eWin]::IsZoomed($h)
    reduite = [E2eWin]::IsIconic($h)
    visible = [E2eWin]::IsWindowVisible($h)
    premierPlan = ([E2eWin]::GetForegroundWindow() -eq $h)
    ecran = Get-Rect $mi.rcMonitor
    travail = Get-Rect $mi.rcWork
  }
}

function Get-Element([IntPtr]$h) { [Windows.Automation.AutomationElement]::FromHandle($h) }

function Get-Textes([IntPtr]$h) {
  $tous = (Get-Element $h).FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  @($tous | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
}

function Get-ChampNomDeFichier([IntPtr]$h) {
  # Sélecteur de fichier de Windows : contrôle d'édition (classe Edit) « Nom du fichier », d'identifiant 1148
  # (boîte d'ouverture) ou 1001 (boîte d'enregistrement). Il peut apparaître un peu après la fenêtre : on le
  # cherche pendant 5 s.
  $cond = New-Object Windows.Automation.AndCondition(
    (New-Object Windows.Automation.OrCondition(
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, '1148')),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')))),
    (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')))
  $limite = (Get-Date).AddSeconds(5)
  do {
    $champ = (Get-Element $h).FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
    if ($champ -and $champ.Current.NativeWindowHandle) { return $champ }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $limite)
  $editions = (Get-Element $h).FindAll([Windows.Automation.TreeScope]::Descendants,
    (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')))
  $ids = @($editions | ForEach-Object { "$($_.Current.AutomationId)/$($_.Current.NativeWindowHandle)" }) -join ', '
  throw "Champ « Nom du fichier » introuvable dans la boîte de dialogue (contrôles Edit : $ids)."
}

function Invoke-Commande($cmd, $a) {
  switch ($cmd) {
    'fenetres' { return @([E2eWin]::Fenetres([uint32]$a[0])) }
    'etat' { return Get-EtatFenetre (Get-FenetrePrincipale ([uint32]$a[0]) ([string]$a[1])) }
    'attendre-fenetre' {
      # Fenêtre visible du processus portant ce titre ; null au-delà du délai.
      $limite = (Get-Date).AddMilliseconds([int]$a[2])
      do {
        $f = [E2eWin]::Fenetres([uint32]$a[0]) | Where-Object { $_.visible -and $_.titre -eq [string]$a[1] } | Select-Object -First 1
        if ($f) { return $f.hwnd }
        Start-Sleep -Milliseconds 100
      } while ((Get-Date) -lt $limite)
      return $null
    }
    'existe' { return [E2eWin]::IsWindow([IntPtr][long]$a[0]) -and [E2eWin]::IsWindowVisible([IntPtr][long]$a[0]) }
    'premier-plan' { return [E2eWin]::PremierPlan([IntPtr][long]$a[0]) }
    'fermer' { return [E2eWin]::PostMessageW([IntPtr][long]$a[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    'textes' { return Get-Textes ([IntPtr][long]$a[0]) }
    'arbre' {
      # Diagnostic : éléments UI Automation de la fenêtre (type, identifiant, nom, classe).
      $tous = (Get-Element ([IntPtr][long]$a[0])).FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
      return @($tous | ForEach-Object { '{0} | {1} | {2} | {3}' -f $_.Current.ControlType.ProgrammaticName, $_.Current.AutomationId, $_.Current.Name, $_.Current.ClassName })
    }
    'bouton' {
      # Clique (UI Automation, motif Invoke) l'élément portant ce nom : bouton classique, ou bouton de
      # TaskDialog (exposé comme volet de classe CCPushButton).
      $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, [string]$a[1])
      $candidats = (Get-Element ([IntPtr][long]$a[0])).FindAll([Windows.Automation.TreeScope]::Descendants, $cond)
      foreach ($b in $candidats) {
        $motif = $null
        if ($b.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$motif)) { $motif.Invoke(); return $true }
      }
      throw "Bouton « $($a[1]) » introuvable."
    }
    'nom-de-fichier' {
      # Sélecteur de fichier (ouvrir ou enregistrer) : place le curseur dans « Nom du fichier », tape le chemin
      # au clavier, puis renvoie ce que contient le champ (pour vérifier avant de valider).
      # args : hwnd, chemin, remplacer (le champ prérempli est d'abord sélectionné par Ctrl+A).
      # Renvoie { avant, apres } : contenu du champ avant et après la frappe.
      $h = [IntPtr][long]$a[0]
      if (-not [E2eWin]::PremierPlan($h)) { throw 'Le sélecteur de fichier ne passe pas au premier plan.' }
      $champ = Get-ChampNomDeFichier $h
      $edition = [IntPtr]$champ.Current.NativeWindowHandle
      if (-not [E2eWin]::FocusControle($edition)) { throw 'Le champ « Nom du fichier » ne prend pas le focus.' }
      Start-Sleep -Milliseconds 100
      $avant = [E2eWin]::TexteControle($edition)
      if ($avant) {
        if (-not $a[2]) { throw "Le champ « Nom du fichier » n'est pas vide : $avant" }
        [E2eWin]::Ctrl($h, 0x41)
        Start-Sleep -Milliseconds 100
      }
      [E2eWin]::Taper($h, [string]$a[1])
      Start-Sleep -Milliseconds 150
      return @{ avant = $avant; apres = [E2eWin]::TexteControle($edition) }
    }
    'attendre-dialogue' {
      # Première boîte de dialogue native (#32770) visible du processus ; null au-delà du délai.
      $limite = (Get-Date).AddMilliseconds([int]$a[1])
      do {
        $f = [E2eWin]::Fenetres([uint32]$a[0]) | Where-Object { $_.visible -and $_.classe -eq '#32770' } | Select-Object -First 1
        if ($f) { return $f }
        Start-Sleep -Milliseconds 100
      } while ((Get-Date) -lt $limite)
      return $null
    }
    'cliquer' {
      # Clic (BM_CLICK) sur le premier bouton à fenêtre propre dont le nom correspond à l'expression régulière
      # (ex. bouton d'un TaskDialog, sans motif Invoke). Renvoie le nom du bouton cliqué.
      $tous = (Get-Element ([IntPtr][long]$a[0])).FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
      foreach ($b in $tous) {
        if ($b.Current.NativeWindowHandle -and $b.Current.Name -match [string]$a[1]) {
          [void][E2eWin]::PostMessageW([IntPtr]$b.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
          return $b.Current.Name
        }
      }
      throw "Aucun bouton ne correspond à « $($a[1]) »."
    }
    'boutons' {
      # Noms des éléments à fenêtre propre de la boîte (boutons), pour diagnostic et vérification.
      $tous = (Get-Element ([IntPtr][long]$a[0])).FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
      return @($tous | Where-Object { $_.Current.NativeWindowHandle -and $_.Current.ClassName -match 'Button' } | ForEach-Object { $_.Current.Name })
    }
    'touche' {
      $h = [IntPtr][long]$a[0]
      if (-not [E2eWin]::PremierPlan($h)) { throw 'La fenêtre ne passe pas au premier plan.' }
      $vk = @{ entree = 0x0D; echap = 0x1B }[[string]$a[1]]
      if (-not $vk) { throw "Touche inconnue : $($a[1])" }
      [E2eWin]::ToucheVirtuelle($h, [uint16]$vk)
      return $true
    }
    'glisser' {
      $h = [IntPtr][long]$a[0]
      if (-not [E2eWin]::PremierPlan($h)) { throw 'La fenêtre ne passe pas au premier plan.' }
      Start-Sleep -Milliseconds 200
      [E2eWin]::Glisser($h, [int]$a[1], [int]$a[2], [int]$a[3], [int]$a[4])
      return $true
    }
    default { throw "Commande inconnue : $cmd" }
  }
}

function Write-Reponse($obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 6
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
  [Console]::Out.Flush()
}

while ($null -ne ($ligne = [Console]::In.ReadLine())) {
  if (-not $ligne.Trim()) { continue }
  try {
    $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ligne)) | ConvertFrom-Json
    $valeur = Invoke-Commande $req.cmd @($req.args)
    Write-Reponse @{ ok = $true; valeur = $valeur }
  } catch {
    Write-Reponse @{ ok = $false; erreur = "$($_.Exception.Message)" }
  }
}
