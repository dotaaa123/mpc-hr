export async function saveBlob(blob,filename) {
  const bridge=window.flutter_inappwebview?.callHandler;
  if (typeof bridge==='function') {
    const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary='';
    for(let index=0;index<bytes.length;index+=16384)binary+=String.fromCharCode(...bytes.subarray(index,index+16384));
    const result=await window.flutter_inappwebview.callHandler('mpcSaveExcel',filename,btoa(binary));
    if (!result?.ok) throw new Error(result?.error||'Excel файлыг хадгалж чадсангүй');
    return result.path;
  }
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return null;
}
