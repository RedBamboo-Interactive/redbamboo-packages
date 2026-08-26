$ErrorActionPreference = 'Stop'

if (-not ('RedBamboo.DesktopProcess' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace RedBamboo
{
    public static class DesktopProcess
    {
        private const uint ProcessCreateProcess = 0x0080;
        private const uint ExtendedStartupInfoPresent = 0x00080000;
        private const uint CreateUnicodeEnvironment = 0x00000400;
        private const uint CreateNoWindow = 0x08000000;
        private static readonly IntPtr ParentProcessAttribute = new IntPtr(0x00020000);

        public static uint Start(string executablePath, string[] arguments, string workingDirectory)
        {
            var shellWindow = GetShellWindow();
            if (shellWindow == IntPtr.Zero)
                throw new InvalidOperationException("The Windows desktop shell is unavailable.");

            uint shellProcessId;
            GetWindowThreadProcessId(shellWindow, out shellProcessId);
            if (shellProcessId == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(),
                    "The Windows desktop shell process could not be identified.");

            var shellProcess = OpenProcess(ProcessCreateProcess, false, shellProcessId);
            if (shellProcess == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(),
                    "The Windows desktop shell process could not be opened.");

            IntPtr attributeList = IntPtr.Zero;
            IntPtr parentValue = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero;
            try
            {
                var attributeListSize = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeListSize);
                if (attributeListSize == IntPtr.Zero)
                    throw new Win32Exception(Marshal.GetLastWin32Error(),
                        "Windows could not size the process attribute list.");

                attributeList = Marshal.AllocHGlobal(attributeListSize);
                if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
                    throw new Win32Exception(Marshal.GetLastWin32Error(),
                        "Windows could not initialize the process attribute list.");

                parentValue = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(parentValue, shellProcess);
                if (!UpdateProcThreadAttribute(attributeList, 0, ParentProcessAttribute,
                        parentValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error(),
                        "Windows could not bind the deployment process to the desktop shell.");

                environment = BuildEnvironmentBlock();
                var startup = new StartupInfoEx
                {
                    StartupInfo = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfoEx)) },
                    AttributeList = attributeList,
                };
                var commandLine = new StringBuilder(Quote(executablePath));
                foreach (var argument in arguments ?? Array.Empty<string>())
                    commandLine.Append(' ').Append(Quote(argument));

                ProcessInformation processInformation;
                if (!CreateProcess(executablePath, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                        ExtendedStartupInfoPresent | CreateUnicodeEnvironment | CreateNoWindow,
                        environment, workingDirectory, ref startup, out processInformation))
                    throw new Win32Exception(Marshal.GetLastWin32Error(),
                        "Windows could not start the desktop-owned deployment process.");

                CloseHandle(processInformation.Thread);
                CloseHandle(processInformation.Process);
                return processInformation.ProcessId;
            }
            finally
            {
                if (attributeList != IntPtr.Zero)
                {
                    DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (parentValue != IntPtr.Zero) Marshal.FreeHGlobal(parentValue);
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                CloseHandle(shellProcess);
            }
        }

        private static IntPtr BuildEnvironmentBlock()
        {
            var excluded = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "REDLEAF_EXECUTION_TOKEN",
                "X_COMPUTE_PROVENANCE",
            };
            var entries = new List<string>();
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
            {
                var key = Convert.ToString(entry.Key) ?? string.Empty;
                if (key.Length == 0 || excluded.Contains(key)) continue;
                entries.Add(key + "=" + (Convert.ToString(entry.Value) ?? string.Empty));
            }
            entries.Sort(StringComparer.OrdinalIgnoreCase);
            var bytes = Encoding.Unicode.GetBytes(string.Join("\0", entries) + "\0\0");
            var block = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, block, bytes.Length);
            return block;
        }

        private static string Quote(string value)
        {
            if (value.Length > 0 && value.All(c => !char.IsWhiteSpace(c) && c != '"')) return value;
            var result = new StringBuilder(value.Length + 2).Append('"');
            var slashes = 0;
            foreach (var character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"')
                {
                    result.Append('\\', slashes * 2 + 1).Append(character);
                    slashes = 0;
                    continue;
                }
                result.Append('\\', slashes).Append(character);
                slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo
        {
            public int Size;
            public string Reserved;
            public string Desktop;
            public string Title;
            public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
            public ushort ShowWindow, Reserved2Size;
            public IntPtr Reserved2, StandardInput, StandardOutput, StandardError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct StartupInfoEx
        {
            public StartupInfo StartupInfo;
            public IntPtr AttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation
        {
            public IntPtr Process, Thread;
            public uint ProcessId, ThreadId;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetShellWindow();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(
            IntPtr attributeList, int attributeCount, uint flags, ref IntPtr size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(
            IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value, IntPtr size,
            IntPtr previousValue, IntPtr returnSize);

        [DllImport("kernel32.dll")]
        private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(
            string applicationName, StringBuilder commandLine, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment,
            string currentDirectory, ref StartupInfoEx startupInfo,
            out ProcessInformation processInformation);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);
    }

    public sealed class LockingProcessInfo
    {
        public int ProcessId { get; set; }
        public string ApplicationName { get; set; }
        public string ServiceName { get; set; }
        public bool Restartable { get; set; }
    }

    public static class RestartManagerInspector
    {
        private const int ErrorMoreData = 234;
        private const int SessionKeyLength = 32;

        public static LockingProcessInfo[] GetLockingProcesses(string[] paths)
        {
            var resources = (paths ?? Array.Empty<string>())
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(System.IO.Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (resources.Length == 0) return Array.Empty<LockingProcessInfo>();

            var sessionKey = new StringBuilder(Guid.NewGuid().ToString("N"), SessionKeyLength + 1);
            uint session;
            var result = RmStartSession(out session, 0, sessionKey);
            if (result != 0) throw new Win32Exception(result, "Restart Manager could not start a session.");
            try
            {
                result = RmRegisterResources(session, (uint)resources.Length, resources,
                    0, null, 0, null);
                if (result != 0)
                    throw new Win32Exception(result, "Restart Manager could not register staged deployment resources.");

                uint needed = 0;
                uint count = 0;
                uint reasons = 0;
                result = RmGetList(session, out needed, ref count, null, ref reasons);
                if (result == 0) return Array.Empty<LockingProcessInfo>();
                if (result != ErrorMoreData)
                    throw new Win32Exception(result, "Restart Manager could not query locking processes.");

                var processInfo = new RmProcessInfo[needed];
                count = needed;
                result = RmGetList(session, out needed, ref count, processInfo, ref reasons);
                if (result != 0)
                    throw new Win32Exception(result, "Restart Manager could not read locking processes.");

                return processInfo.Take((int)count).Select(info => new LockingProcessInfo
                {
                    ProcessId = info.Process.ProcessId,
                    ApplicationName = info.ApplicationName,
                    ServiceName = info.ServiceShortName,
                    Restartable = info.Restartable,
                }).ToArray();
            }
            finally
            {
                RmEndSession(session);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RmUniqueProcess
        {
            public int ProcessId;
            public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
        }

        private enum RmAppType
        {
            Unknown = 0,
            MainWindow = 1,
            OtherWindow = 2,
            Service = 3,
            Explorer = 4,
            Console = 5,
            Critical = 1000,
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct RmProcessInfo
        {
            public RmUniqueProcess Process;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string ApplicationName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string ServiceShortName;
            public RmAppType ApplicationType;
            public uint AppStatus;
            public uint TerminalServicesSessionId;
            [MarshalAs(UnmanagedType.Bool)]
            public bool Restartable;
        }

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmStartSession(out uint sessionHandle, int sessionFlags,
            StringBuilder sessionKey);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        private static extern int RmRegisterResources(uint sessionHandle, uint fileCount,
            string[] fileNames, uint applicationCount, RmUniqueProcess[] applications,
            uint serviceCount, string[] serviceNames);

        [DllImport("rstrtmgr.dll")]
        private static extern int RmGetList(uint sessionHandle, out uint processInfoNeeded,
            ref uint processInfoCount, [In, Out] RmProcessInfo[] affectedApplications,
            ref uint rebootReasons);

        [DllImport("rstrtmgr.dll")]
        private static extern int RmEndSession(uint sessionHandle);
    }
}
'@
}

function Start-RedBambooDesktopProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    $resolvedFile = (Resolve-Path -LiteralPath $FilePath).Path
    $resolvedWorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
    [RedBamboo.DesktopProcess]::Start($resolvedFile, $ArgumentList, $resolvedWorkingDirectory)
}

function Get-RedBambooLockOwners {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Directory
    )

    $resolvedDirectory = [IO.Path]::GetFullPath($Directory)
    if (-not (Test-Path -LiteralPath $resolvedDirectory)) { return @() }
    $files = @(Get-ChildItem -LiteralPath $resolvedDirectory -Recurse -File -Force `
        -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    if ($files.Count -eq 0) { return @() }
    try {
        @([RedBamboo.RestartManagerInspector]::GetLockingProcesses($files) |
            ForEach-Object {
                $name = if ($_.ApplicationName) { $_.ApplicationName } else { 'unknown' }
                $service = if ($_.ServiceName) { ", service $($_.ServiceName)" } else { '' }
                "PID $($_.ProcessId) ($name$service)"
            })
    } catch {
        @("lock-owner query failed: $($_.Exception.Message)")
    }
}

function Get-RedBambooTreeManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Directory
    )

    $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Manifest directory is missing: $root"
    }

    @(
        Get-ChildItem -LiteralPath $root -Recurse -File -Force |
            ForEach-Object {
                [pscustomobject]@{
                    relativePath = $_.FullName.Substring($root.Length + 1)
                    length = [long]$_.Length
                    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
                }
            } |
            Sort-Object relativePath
    )
}

function Assert-RedBambooTreeManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][object[]]$ExpectedManifest
    )

    $expected = @($ExpectedManifest | Sort-Object relativePath)
    $actual = @(Get-RedBambooTreeManifest -Directory $Directory)
    if ($actual.Count -ne $expected.Count) {
        throw "Deployment tree file count mismatch at '$Directory': expected $($expected.Count), found $($actual.Count)."
    }

    for ($index = 0; $index -lt $expected.Count; $index++) {
        $wanted = $expected[$index]
        $found = $actual[$index]
        if (-not [string]::Equals(
                [string]$wanted.relativePath,
                [string]$found.relativePath,
                [StringComparison]::OrdinalIgnoreCase) -or
            [long]$wanted.length -ne [long]$found.length -or
            -not [string]::Equals(
                [string]$wanted.sha256,
                [string]$found.sha256,
                [StringComparison]::OrdinalIgnoreCase)) {
            throw "Deployment tree mismatch at '$Directory': expected '$($wanted.relativePath)' ($($wanted.length), $($wanted.sha256)); found '$($found.relativePath)' ($($found.length), $($found.sha256))."
        }
    }

    $true
}

function Invoke-RedBambooMirrorTree {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination,
        [ValidateRange(0, 20)][int]$RetryCount = 3,
        [ValidateRange(1, 30)][int]$RetryWaitSeconds = 1
    )

    $sourcePath = [IO.Path]::GetFullPath($Source)
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
        throw "Mirror source directory is missing: $sourcePath"
    }
    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null

    & robocopy.exe $sourcePath $destinationPath /MIR /COPY:DAT /DCOPY:DAT /XJ `
        "/R:$RetryCount" "/W:$RetryWaitSeconds" /NP /NFL /NDL /NJH /NJS
    $result = $LASTEXITCODE
    if ($result -gt 7) {
        $owners = @(Get-RedBambooLockOwners -Directory $destinationPath)
        $ownerText = if ($owners.Count -gt 0) { $owners -join '; ' } else { 'none reported' }
        throw "Directory mirror failed from '$sourcePath' to '$destinationPath' with robocopy exit code $result. Lock owners: $ownerText"
    }

    $result
}

function Enter-RedBambooDeploymentLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path
    )

    $lockPath = [IO.Path]::GetFullPath($Path)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($lockPath)) -Force | Out-Null
    try {
        [IO.File]::Open(
            $lockPath,
            [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None)
    } catch {
        throw "Another deployment owns '$lockPath': $($_.Exception.Message)"
    }
}
