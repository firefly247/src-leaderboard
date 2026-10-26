export function makeUtilities(hash, uuid = () => crypto.randomUUID()) {
  const bytes=value=>typeof value==='string'?new TextEncoder().encode(value):Uint8Array.from(value);
  const base64=value=>btoa(Array.from(bytes(value),b=>String.fromCharCode(b)).join(''));
  function parseCsv(text) {
    const rows=[],row=[];let field='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
      else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row.splice(0));else row.splice(0);field='';}else field+=c;}
    row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);return rows;
  }
  return {DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:uuid,
    computeDigest:(_,value)=>Array.from(hash(bytes(value))),base64Encode:base64,
    base64EncodeWebSafe:value=>base64(value).replace(/\+/g,'-').replace(/\//g,'_'),
    base64Decode:value=>Array.from(atob(value),c=>c.charCodeAt(0)),parseCsv,
    formatDate:date=>new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(date)};
}
