"use strict";
const { execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const core = require("./vault-core.cjs");
function command(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
async function scan() {
  const drives = [];
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $result=@(Get-Disk | Where-Object { $_.BusType -eq 'USB' -and -not $_.IsBoot -and -not $_.IsSystem } | ForEach-Object { $disk=$_; Get-Partition -DiskNumber $disk.Number | Where-Object DriveLetter | ForEach-Object { $v=$_ | Get-Volume; [pscustomobject]@{ root=([string]$_.DriveLetter+':\\'); physical=([string]$disk.Number+':'+[string]$disk.UniqueId); label=[string]$v.FileSystemLabel; size=$v.Size; free=$v.SizeRemaining } } }); ConvertTo-Json -InputObject $result -Compress`;
    const exe = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const output = await command(exe, [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ]);
    drives.push(...list(JSON.parse(output.replace(/^\uFEFF/, ""))));
  } else if (process.platform === "linux") {
    const data = JSON.parse(
      await command("/usr/bin/lsblk", [
        "--json",
        "--bytes",
        "--output",
        "NAME,TYPE,TRAN,RM,MOUNTPOINTS,SERIAL,WWN,SIZE",
      ]),
    );
    for (const disk of data.blockdevices || []) {
      if (disk.type !== "disk" || disk.tran !== "usb") continue;
      const systemDisk = (node) =>
        list(node.mountpoints).some(
          (p) =>
            p === "/" || p === "/home" || p === "/boot" || p === "/boot/efi",
        ) || (node.children || []).some(systemDisk);
      if (systemDisk(disk)) continue;
      const physical = [disk.name, disk.serial || "", disk.wwn || ""].join(":");
      const visit = (node) => {
        for (const root of list(node.mountpoints).filter(Boolean)) {
          if (root === "/" || root === "/boot" || root === "/home") continue;
          drives.push({
            root,
            physical,
            label: node.name,
            size: Number(node.size),
            free: null,
          });
        }
        for (const child of node.children || []) visit(child);
      };
      visit(disk);
    }
  } else if (process.platform === "darwin") {
    const plist = async (args) =>
      JSON.parse(
        await command(
          "/usr/bin/plutil",
          ["-convert", "json", "-o", "-", "-"],
          await command("/usr/sbin/diskutil", args),
        ),
      );
    const data = await plist(["list", "-plist", "external", "physical"]);
    const apfs = await plist(["apfs", "list", "-plist"]);
    for (const disk of data.AllDisksAndPartitions || []) {
      const info = await plist(["info", "-plist", disk.DeviceIdentifier]);
      if (info.Internal !== false || info.BusProtocol !== "USB") continue;
      const volumes = (apfs.Containers || [])
        .filter(
          (container) =>
            (container.PhysicalStores || []).length === 1 &&
            container.PhysicalStores[0].DeviceIdentifier.startsWith(
              disk.DeviceIdentifier + "s",
            ),
        )
        .flatMap((container) => container.Volumes || []);
      for (const part of [disk, ...(disk.Partitions || []), ...volumes]) {
        const p = await plist(["info", "-plist", part.DeviceIdentifier]);
        if (p.MountPoint)
          drives.push({
            root: p.MountPoint,
            physical: disk.DeviceIdentifier,
            label: p.VolumeName || part.DeviceIdentifier,
            size: p.TotalSize,
            free: p.VolumeFreeSpace,
          });
      }
    }
  } else core.fail("UNSUPPORTED_PLATFORM");
  return drives
    .filter((d, i) => drives.findIndex((other) => other.root === d.root) === i)
    .map((d) => ({
      ...d,
      token: crypto
        .createHash("sha256")
        .update(d.physical + "\0" + d.root)
        .digest("hex"),
    }));
}
function pair(drives, primary, secondary) {
  const a = drives.find((d) => d.token === primary),
    b = drives.find((d) => d.token === secondary);
  if (!a || !b) core.fail("USB_NOT_PRESENT");
  if (a.physical === b.physical) core.fail("TWO_PHYSICAL_DRIVES_REQUIRED");
  return [a, b];
}
// Refuse symlink/junction redirection at every existing path component inside the USB.
async function location(drive, envelope, role) {
  const parts = [
    "LegacyLock",
    envelope.id,
    String(envelope.recovery.generation),
  ];
  let dir = drive.root;
  for (const part of parts) {
    dir = path.join(dir, part);
    try {
      const s = await fs.lstat(dir);
      if (s.isSymbolicLink() || !s.isDirectory())
        core.fail("UNSAFE_MEDIA_PATH");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const key = path.join(
      dir,
      role === "PRIMARY" ? "primary.llkey" : "secondary.llkey",
    ),
    vault = path.join(dir, "vault.llvault");
  for (const file of [key, vault, vault + ".previous"]) {
    try {
      if ((await fs.lstat(file)).isSymbolicLink())
        core.fail("UNSAFE_MEDIA_PATH");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return { key, vault };
}
module.exports = { scan, pair, location };
