/** Feature detection for WebGL before anything is created. */
export function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      gl2.getExtension('WEBGL_lose_context')?.loseContext();
      return { ok: true, version: 2 };
    }
    const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl1) {
      gl1.getExtension('WEBGL_lose_context')?.loseContext();
      return { ok: false, version: 1, reason: 'webgl1-only' };
    }
    return { ok: false, version: 0, reason: window.WebGLRenderingContext ? 'disabled' : 'unsupported' };
  } catch (e) {
    return { ok: false, version: 0, reason: 'error', error: e };
  }
}

const MESSAGES = {
  'webgl1-only': {
    title: 'อุปกรณ์รองรับแค่ WebGL 1',
    body: 'เกมนี้ต้องใช้ WebGL 2 สำหรับ Shader และเอฟเฟกต์เมือก ลองอัปเดตเบราว์เซอร์ (Chrome, Safari 15+, Firefox, Edge) หรือเปิดบนอุปกรณ์อื่น',
  },
  disabled: {
    title: 'WebGL ถูกปิดอยู่',
    body: 'เบราว์เซอร์รองรับ WebGL แต่ถูกปิดหรือถูกบล็อก ลองเปิด "Hardware acceleration" ในการตั้งค่าเบราว์เซอร์ แล้วโหลดหน้าใหม่',
  },
  unsupported: {
    title: 'เบราว์เซอร์ไม่รองรับ WebGL',
    body: 'ต้องใช้เบราว์เซอร์ที่รองรับกราฟิก 3D (WebGL 2) เช่น Chrome, Safari, Firefox หรือ Edge รุ่นล่าสุด',
  },
  error: {
    title: 'เริ่มเกมไม่สำเร็จ',
    body: 'เกิดข้อผิดพลาดระหว่างเตรียมกราฟิก 3D ลองโหลดหน้าใหม่ ปิดแท็บอื่นที่ใช้กราฟิกหนัก หรือเปิดบนอุปกรณ์อื่น',
  },
};

export function showFatalError(reason, error) {
  const m = MESSAGES[reason] || MESSAGES.error;
  document.getElementById('loading')?.classList.add('hidden');
  const wrap = document.createElement('div');
  wrap.className = 'error-screen';
  const detail = error ? `<code>${String(error.message || error).replace(/[<>&]/g, '')}</code>` : '';
  wrap.innerHTML = `<div class="error-card"><div class="error-face">🫠</div><h1>${m.title}</h1><p>${m.body}</p>${detail}
    <p style="margin-top:14px"><button class="btn primary" onclick="location.reload()">ลองใหม่อีกครั้ง</button></p></div>`;
  document.body.appendChild(wrap);
}
