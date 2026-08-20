/**
 * Input simulation command construction. Tools run through `ctx.shell` so the
 * same sandbox policy applies as for `tool-screenshot`; the generated commands
 * use an embedded C# helper (user32 SendInput/SetCursorPos) to simulate real
 * mouse and keyboard input on the current Windows desktop.
 *
 * @module @deepseek-ai/dsh-tool-input
 */

/** One screen point in pixels. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** Mouse button names accepted by the input helper. */
export type MouseButton = 'left' | 'right' | 'middle'

/** Mouse trajectory terminal action. */
export type MouseAction = 'move' | 'click' | 'double-click' | 'drag'

/** Inputs for the mouse trajectory tool. */
export interface MouseTrajectoryOptions {
  readonly points: readonly Point[]
  readonly durationMs?: number
  readonly action?: MouseAction
  readonly button?: MouseButton
}

/** Inputs for the mouse click tool. */
export interface MouseClickOptions {
  readonly x: number
  readonly y: number
  readonly button?: MouseButton
  readonly clicks?: number
  readonly durationMs?: number
}

/** Inputs for the mouse scroll tool. */
export interface MouseScrollOptions {
  readonly delta: number
  readonly x?: number
  readonly y?: number
}

/** Inputs for the keyboard input tool. */
export interface KeyboardInputOptions {
  readonly text?: string
  readonly keys?: readonly string[]
  readonly delayMs?: number
}

const C_SHARP_HELPER = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class DshInput
{
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;

    public static void Move(int x, int y)
    {
        SetCursorPos(x, y);
    }

    public static void Click(string button, int x, int y, int clicks)
    {
        Move(x, y);
        uint down = DownFlag(button);
        uint up = UpFlag(button);
        for (int i = 0; i < clicks; i++)
        {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
        }
    }

    public static void Scroll(int delta, int x, int y)
    {
        if (x >= 0 && y >= 0) Move(x, y);
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
    }

    public static void Trajectory(int[] xs, int[] ys, int durationMs, string action, string button)
    {
        if (xs.Length == 0 || ys.Length == 0 || xs.Length != ys.Length) return;
        int n = xs.Length;
        if (n == 1)
        {
            Move(xs[0], ys[0]);
            if (action == "click") Click(button, xs[0], ys[0], 1);
            else if (action == "double-click") Click(button, xs[0], ys[0], 2);
            return;
        }

        if (action == "drag") MouseDown(button);
        Move(xs[0], ys[0]);

        double[] cumulative = new double[n - 1];
        double total = 0;
        for (int i = 0; i < n - 1; i++)
        {
            double dx = xs[i + 1] - xs[i];
            double dy = ys[i + 1] - ys[i];
            total += Math.Sqrt(dx * dx + dy * dy);
            cumulative[i] = total;
        }

        int steps = Math.Max(1, durationMs / 10);
        for (int step = 1; step <= steps; step++)
        {
            double t = (double)step / steps * total;
            int seg = 0;
            while (seg < cumulative.Length - 1 && cumulative[seg] < t) seg++;
            double segStart = seg == 0 ? 0 : cumulative[seg - 1];
            double segLen = cumulative[seg] - segStart;
            double local = segLen <= 0 ? 0 : (t - segStart) / segLen;
            int x = (int)Math.Round(xs[seg] + (xs[seg + 1] - xs[seg]) * local);
            int y = (int)Math.Round(ys[seg] + (ys[seg + 1] - ys[seg]) * local);
            Move(x, y);
            Thread.Sleep(10);
        }

        Move(xs[n - 1], ys[n - 1]);
        if (action == "click") Click(button, xs[n - 1], ys[n - 1], 1);
        else if (action == "double-click") Click(button, xs[n - 1], ys[n - 1], 2);
        else if (action == "drag") MouseUp(button);
    }

    public static void Keyboard(string text, string[] keys, int delayMs)
    {
        if (keys != null && keys.Length > 0)
        {
            ushort[] vks = new ushort[keys.Length];
            for (int i = 0; i < keys.Length; i++) vks[i] = GetVk(keys[i]);
            foreach (ushort vk in vks)
            {
                SendKey(vk, false);
                Thread.Sleep(delayMs);
            }
            for (int i = vks.Length - 1; i >= 0; i--)
            {
                SendKey(vks[i], true);
                Thread.Sleep(delayMs);
            }
        }
        if (text != null && text.Length > 0)
        {
            foreach (char c in text)
            {
                SendUnicode(c);
                Thread.Sleep(delayMs);
            }
        }
    }

    static uint DownFlag(string button)
    {
        switch (button)
        {
            case "right": return MOUSEEVENTF_RIGHTDOWN;
            case "middle": return MOUSEEVENTF_MIDDLEDOWN;
            default: return MOUSEEVENTF_LEFTDOWN;
        }
    }

    static uint UpFlag(string button)
    {
        switch (button)
        {
            case "right": return MOUSEEVENTF_RIGHTUP;
            case "middle": return MOUSEEVENTF_MIDDLEUP;
            default: return MOUSEEVENTF_LEFTUP;
        }
    }

    static void MouseDown(string button)
    {
        mouse_event(DownFlag(button), 0, 0, 0, UIntPtr.Zero);
    }

    static void MouseUp(string button)
    {
        mouse_event(UpFlag(button), 0, 0, 0, UIntPtr.Zero);
    }

    static void SendUnicode(char c)
    {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.ki.wVk = 0;
        inputs[0].U.ki.wScan = (ushort)c;
        inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
        inputs[1] = inputs[0];
        inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static void SendKey(ushort vk, bool keyUp)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.ki.wVk = vk;
        inputs[0].U.ki.dwFlags = keyUp ? KEYEVENTF_KEYUP : 0;
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static ushort GetVk(string key)
    {
        switch (key.ToLowerInvariant())
        {
            case "enter": return 0x0D;
            case "tab": return 0x09;
            case "esc": case "escape": return 0x1B;
            case "space": return 0x20;
            case "backspace": return 0x08;
            case "delete": return 0x2E;
            case "up": return 0x26;
            case "down": return 0x28;
            case "left": return 0x25;
            case "right": return 0x27;
            case "home": return 0x24;
            case "end": return 0x23;
            case "pageup": return 0x21;
            case "pagedown": return 0x22;
            case "ctrl": case "control": return 0x11;
            case "shift": return 0x10;
            case "alt": return 0x12;
            case "win": case "windows": case "meta": return 0x5B;
            default:
                if (key.Length == 1)
                {
                    char c = char.ToUpperInvariant(key[0]);
                    if (c >= 'A' && c <= 'Z') return (ushort)c;
                    if (c >= '0' && c <= '9') return (ushort)c;
                }
                int f;
                if (key.StartsWith("F", StringComparison.OrdinalIgnoreCase)
                    && int.TryParse(key.Substring(1), out f)
                    && f >= 1 && f <= 24) return (ushort)(0x6F + f);
                return 0;
        }
    }
}
`

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`)
  }
  return Math.round(value)
}

function nonNegativeInteger(value: unknown, name: string): number {
  const n = integer(value, name)
  if (n < 0) throw new Error(`${name} must be non-negative`)
  return n
}

function positiveInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const n = integer(value, name)
  if (n <= 0) throw new Error(`${name} must be positive`)
  return n
}

function validatePoints(points: readonly Point[]): void {
  if (points.length === 0) throw new Error('points must contain at least one point')
  for (const [index, point] of points.entries()) {
    nonNegativeInteger(point.x, `points[${index}].x`)
    nonNegativeInteger(point.y, `points[${index}].y`)
  }
}

function pointArray(points: readonly Point[]): { xs: string; ys: string } {
  const xs = points.map(point => point.x).join(',')
  const ys = points.map(point => point.y).join(',')
  return { xs: `@(${xs})`, ys: `@(${ys})` }
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function powershellCommand(calls: readonly string[]): string {
  const code = C_SHARP_HELPER.replaceAll('`', '``').replaceAll('$', '`$')
  return [
    "$ErrorActionPreference='Stop'",
    `$code = @'\n${code}\n'@`,
    'Add-Type -TypeDefinition $code -Language CSharp',
    ...calls,
  ].join('; ')
}

/**
 * Build the PowerShell command for mouse trajectory movement/click/drag.
 * @param options - trajectory points and terminal action.
 * @returns a PowerShell command string.
 */
export function buildMouseTrajectoryCommand(options: MouseTrajectoryOptions): string {
  validatePoints(options.points)
  const durationMs = positiveInteger(options.durationMs, 'duration_ms', 300)
  const action = options.action ?? 'move'
  const button = options.button ?? 'left'
  const { xs, ys } = pointArray(options.points)
  return powershellCommand([`[DshInput]::Trajectory(${xs}, ${ys}, ${durationMs}, '${action}', '${button}')`])
}

/**
 * Build the PowerShell command for a mouse click at one coordinate.
 * @param options - click coordinate, button, click count, and optional duration.
 * @returns a PowerShell command string.
 */
export function buildMouseClickCommand(options: MouseClickOptions): string {
  const x = nonNegativeInteger(options.x, 'x')
  const y = nonNegativeInteger(options.y, 'y')
  const button = options.button ?? 'left'
  const clicks = positiveInteger(options.clicks ?? 1, 'clicks', 1)
  const durationMs = positiveInteger(options.durationMs, 'duration_ms', 100)
  const action = clicks > 1 ? 'double-click' : 'click'
  return buildMouseTrajectoryCommand({ points: [{ x, y }], durationMs, action, button })
}

/**
 * Build the PowerShell command for a mouse wheel scroll.
 * @param options - scroll delta and optional target coordinate.
 * @returns a PowerShell command string.
 */
export function buildMouseScrollCommand(options: MouseScrollOptions): string {
  const delta = integer(options.delta, 'delta')
  const x = options.x === undefined ? -1 : nonNegativeInteger(options.x, 'x')
  const y = options.y === undefined ? -1 : nonNegativeInteger(options.y, 'y')
  return powershellCommand([`[DshInput]::Scroll(${delta}, ${x}, ${y})`])
}

/**
 * Build the PowerShell command for keyboard text/keys input.
 * @param options - literal text, key combo, and per-key delay.
 * @returns a PowerShell command string.
 */
export function buildKeyboardCommand(options: KeyboardInputOptions): string {
  const text = options.text ?? ''
  const keys = options.keys ?? []
  const delayMs = positiveInteger(options.delayMs, 'delay_ms', 30)
  if (text === '' && keys.length === 0) {
    throw new Error('keyboard_input requires text or keys')
  }
  const textBase64 = base64(text)
  const keysArray = keys.length === 0 ? '@()' : `@(${keys.map(key => `'${key.replaceAll("'", "''")}'`).join(',')})`
  return powershellCommand([`[DshInput]::Keyboard([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${textBase64}')), ${keysArray}, ${delayMs})`])
}
