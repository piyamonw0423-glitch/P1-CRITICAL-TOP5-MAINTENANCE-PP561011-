# P1 Repair Dashboard

แดชบอร์ดติดตามงานซ่อมเร่งด่วน (Priority 1) Top 5 ของโรงไฟฟ้า 5, 10, 6 และ 11 ในหน้าเดียว
สำหรับผู้บริหารและทีมงาน — สร้างจากงานออกแบบ "P1 Repair Dashboard v2" (Claude Design, ดู `project/` และ `chats/`)

## ความสามารถ

- ตัวเลขรวม: ทั้งหมด / เสร็จแล้ว / กำลังดำเนินการ / ค้างหรือเกินกำหนด + Key Highlights สรุปอัตโนมัติ
- การ์ดรายโรง: วงกลม % สำเร็จ, ผลกระทบต่อโรงไฟฟ้า, Top 5 งาน (ปัญหา, แนวทาง, ผู้รับผิดชอบ, ระยะเวลา, ความคืบหน้า, สิ่งที่ติด, รูปหน้างาน)
- ตัวกรองเลือกดู: ทั้งหมด / รายกลุ่ม (5+10, 6+11) / รายโรง — เก็บใน URL (`?view=10`) จึงบุ๊กมาร์กหรือแชร์ลิงก์ได้
- สรุปปัญหาที่ติด (Blocker) และกราฟแนวโน้ม
- โหมด "อัปเดตงานประจำวัน": แก้ไข/เพิ่ม/ลบงาน, แก้ผลกระทบ, อัปโหลดรูปงานละไม่เกิน 4 รูป
- ส่งออก / นำเข้าไฟล์ JSON เพื่อแชร์ข้อมูลชุดเดียวกันให้ทีม
- สั่งพิมพ์ (Ctrl+P) เป็นหน้าเดียว A3 แนวนอน

> ข้อมูลบันทึกใน `localStorage` ของเบราว์เซอร์ที่แก้ไขเท่านั้น
> หากต้องการให้ทุกคนเห็นข้อมูลเดียวกันแบบเรียลไทม์ ต้องเชื่อมต่อฐานข้อมูลกลาง (เช่น Google Sheet / Firebase / Supabase)

## พัฒนา

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # ไฟล์เว็บพร้อมใช้งานใน dist/
npm run preview
```

`dist/` เป็นเว็บแบบ static ใช้ path แบบ relative วางบนโฮสต์ใดก็ได้
มี workflow `.github/workflows/deploy.yml` สำหรับ deploy ขึ้น GitHub Pages อัตโนมัติเมื่อ push เข้า `main`
(ต้องตั้ง Settings → Pages → Source เป็น "GitHub Actions")

### เผยแพร่เป็นหน้าเว็บบน claude.ai (Artifact)

```bash
npm run build:artifact   # สร้าง dist-artifact/p1-dashboard.html (ไฟล์เดียว, React โหลดจาก cdnjs)
```

## โครงสร้าง

- `src/lib/data.js` — ข้อมูลตั้งต้น, สีประจำโรง/สถานะ/ปัญหา, การบันทึก
- `src/lib/view.js` — คำนวณตัวเลข, Top 5, Highlights, แนวโน้ม
- `src/components/` — Header, Summary, PlantCard, Insights, Modals
- `src/styles.css` — สไตล์ทั้งหมด (ค่าสีตามงานออกแบบ)
