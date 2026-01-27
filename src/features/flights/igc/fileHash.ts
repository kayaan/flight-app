// // src/features/flights/igc/fileHash.ts
// export async function hashFileSha256(file: File): Promise<string> {
//     const buf = await file.arrayBuffer();
//     const digest = await crypto.subtle.digest("SHA-256", buf);
//     return toHex(digest);
// }

// function toHex(ab: ArrayBuffer): string {
//     const bytes = new Uint8Array(ab);
//     let out = "";
//     for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
//     return out;
// }
