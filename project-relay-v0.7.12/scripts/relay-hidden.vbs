Option Explicit
Dim sh, psScript, cmd
If WScript.Arguments.Count < 1 Then WScript.Quit 2
psScript = WScript.Arguments(0)
Set sh = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & psScript & Chr(34)
sh.Run cmd, 0, False
