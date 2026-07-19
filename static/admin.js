const input = document.getElementById('csvFile');
const preview = document.getElementById('csvPreview');
const uploadButton = document.getElementById('uploadButton');

if (input) {
  input.addEventListener('change', async () => {
    uploadButton.disabled = true;
    preview.hidden = true;
    preview.innerHTML = '';
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      preview.textContent = '파일 크기가 2MB를 초과합니다.';
      preview.hidden = false;
      return;
    }
    const text = await file.text();
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      preview.textContent = '헤더와 데이터 행이 필요합니다.';
      preview.hidden = false;
      return;
    }
    const headers = lines[0].split(',').map(v => v.trim());
    const requiredGroups = [['이름', 'name', 'member_name'], ['종목', 'event'], ['기록', 'time', 'record']];
    const lower = headers.map(v => v.toLowerCase());
    const missing = requiredGroups.filter(group => !group.some(name => lower.includes(name.toLowerCase())));
    if (missing.length) {
      preview.textContent = '필수 헤더가 없습니다: 이름, 종목, 기록';
      preview.hidden = false;
      return;
    }
    preview.innerHTML = `<strong>${file.name}</strong><span>${lines.length - 1}개 데이터 행을 확인했습니다. 서버에서 다시 검증한 후 저장합니다.</span>`;
    preview.hidden = false;
    uploadButton.disabled = false;
  });
}
