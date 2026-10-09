import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { MosrGpu } from "../../common/mosr-preview";

// DirectML IDs follow DXGI enumeration, not Chromium or the NCNN/Vulkan list.
// Run only this bundled, argument-free query; renderer input is never script text.
const query = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MosrAdapters {
 [DllImport("dxgi.dll", CallingConvention=CallingConvention.StdCall)] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Desc {
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string Description;
  public uint VendorId, DeviceId, SubSysId, Revision;
  public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
  public uint LuidLow; public int LuidHigh; public uint Flags;
 }
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Enum1(IntPtr self,uint index,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc1(IntPtr self,out Desc desc);
 public static object[] List() {
  var guid=new Guid("770aae78-f26f-4dba-a829-253c83d1b387"); IntPtr factory;
  Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref guid,out factory));
  var list=new List<object>();
  try {
   var enumerate=(Enum1)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(factory),12*IntPtr.Size),typeof(Enum1));
   for(uint i=0;;i++) {
    IntPtr adapter; int result=enumerate(factory,i,out adapter);
    if(result==unchecked((int)0x887A0002)) break;
    Marshal.ThrowExceptionForHR(result);
    try {
     var getDesc=(GetDesc1)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(adapter),10*IntPtr.Size),typeof(GetDesc1));
     Desc d; Marshal.ThrowExceptionForHR(getDesc(adapter,out d));
     if((d.Flags & 2)==0) list.Add(new {id=i,name=d.Description,luid=String.Format("{0:X8}:{1:X8}",d.LuidHigh,d.LuidLow)});
    } finally { Marshal.Release(adapter); }
   }
  } finally { Marshal.Release(factory); }
  return list.ToArray();
 }
}
'@
ConvertTo-Json -Compress -InputObject @([MosrAdapters]::List())
`;

export async function getMosrGpus(): Promise<MosrGpu[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await promisify(execFile)(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(query, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: "utf8" },
    );
    const gpus = JSON.parse(stdout);
    if (!Array.isArray(gpus) || gpus.some(gpu => !Number.isInteger(gpu.id) || gpu.id < 0 || typeof gpu.name !== "string" || !gpu.name.trim() || typeof gpu.luid !== "string" || !/^[0-9a-f]{8}:[0-9a-f]{8}$/i.test(gpu.luid))) {
      throw new Error("Invalid DXGI adapter list.");
    }
    return gpus.map(gpu => ({ id: gpu.id, name: gpu.name.trim(), luid: gpu.luid.toLowerCase() }));
  } catch {
    throw new Error("Could not list MoSR GPUs. Choose Default or restart Rescayl to try again.");
  }
}
