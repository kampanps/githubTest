# คู่มือสาธิตหน้าชั้นเรียน

เอกสารนี้เขียนไว้สำหรับ **รันโชว์สด** — ทุก output ในนี้คือของจริงที่รันบนโปรเจคนี้แล้ว ไม่ได้แต่งขึ้น

สองเรื่องหลัก:

1. [ทำให้พังตรงไหน แล้วมันจะออกมาหน้าตายังไง](#2-เคสทำให้พัง)
2. [ถ้ายิงเข้าไปพร้อมกันสองคนจะเกิดอะไรขึ้น](#3-ยิงพร้อมกันสองคน)

---

## 0. กฎเหล็กก่อนขึ้นเวที

> **ทุกเคสในเอกสารนี้ย้อนกลับได้หมด** และท้ายทุกเคสมีคำสั่ง revert กำกับไว้
> ถ้าหลงทางเมื่อไหร่ ข้ามไปที่ [ปุ่ม panic](#5-ปุ่ม-panic-กลับเขียวทันที) ได้เลย

เช็ค 4 อย่างนี้ก่อนเริ่ม ควรเขียวหมด:

```bash
npm ci && npm test && npm run build && npm run smoke
```

ต้องได้:

```
Test Suites: 18 passed, 18 total
Tests:      396 passed, 396 total
OK    compiled build boots, migrates and serves requests
```

**Coverage gate ตั้งไว้หลวมโดยตั้งใจ** (85% global / 95% domain) ขณะที่ของจริงอยู่ที่ ~98.7% / ~96.2%
เผื่อไว้เยอะขนาดนี้เพื่อไม่ให้มันแดงเองตอนคุณกำลังพูดอยู่ ถ้าอยากให้แดงต้อง[สั่งให้แดง](#เคส-c-coverage-gate)

---

## 1. ลำดับการรันโชว์ (ตอนที่ยังเขียว)

| # | คำสั่ง | ใช้เวลา | จุดที่ให้นักเรียนดู |
|---|---|---|---|
| 1 | `npm run typecheck` | ~3s | เงียบ = ผ่าน นี่คือ stage แรกของ pipeline |
| 2 | `npm run test:unit` | ~2s | 247 tests ใน 2 วินาที เพราะไม่แตะ I/O เลย |
| 3 | `npm run test:integration` | ~4s | 149 tests ยิง HTTP + SQLite จริง |
| 4 | `npm run test:coverage` | ~11s | ตารางความครอบคลุม + gate |
| 5 | `npm run build && npm run smoke` | ~6s | เอา `dist/` ที่คอมไพล์แล้วมาบูตจริง |

ชี้ให้ดูว่า **unit เร็วกว่า integration ~2 เท่าทั้งที่มีเทสมากกว่า** — เหตุผลที่ pipeline แยกสอง job และให้ unit รันก่อน

---

## 2. เคสทำให้พัง

ทุกเคสจัดเรียงจาก "แดงเร็วสุด" ไป "แดงลึกสุด"

### เคส A — Type error (stage `build` แดง)

**แก้ที่:** [src/services/bookService.ts:23](../src/services/bookService.ts#L23)

```diff
- if (repos.books.findByIsbn(result.value.isbn)) {
+ if (repos.books.findByIsbn(result.value)) {
```

**รัน:**

```bash
npm run typecheck
```

**ได้:**

```
src/services/bookService.ts(23,34): error TS2345: Argument of type 'CreateBookInput' is not assignable to parameter of type 'string'.
```

exit code = `2`

**ประเด็นที่ให้ดู:** เทสไม่ได้รันสักตัวเดียว pipeline ตายตั้งแต่ stage แรก — นี่คือเหตุผลที่วาง typecheck ไว้หน้าสุด มันถูกและเร็วที่สุด

**revert:** เปลี่ยน `result.value` กลับเป็น `result.value.isbn`

---

### เคส B — เปลี่ยนกฎธุรกิจ (`unit` แดง แล้วลามลง `integration`)

**แก้ที่:** [src/domain/policy.ts](../src/domain/policy.ts) — ค่าปรับต่อวัน

```diff
- export const FINE_PER_DAY_CENTS = 500;
+ export const FINE_PER_DAY_CENTS = 600;
```

**รัน:**

```bash
npm test
```

**ได้:**

```
● calculateFine › stops exactly at the cap

    expect(received).toBe(expected)

    Expected: 50000
    Received: 49800

● /api/loans › returning › charges a fine for a late return, after the grace day

    - Expected  - 1
    + Received  + 1

      Object {
    -   "amountCents": 2500,
    +   "amountCents": 3000,
        "memberId": 1,
        "status": "UNPAID",
      }

Test Suites: 4 failed, 14 passed, 18 total
Tests:       4 failed, 392 passed, 396 total
```

**ประเด็นที่ให้ดู — อันนี้สอนได้ดีมาก:** แก้ค่าคงที่ตัวเดียว แต่พังแค่ **4 จาก 396** เทส
เพราะเทสส่วนใหญ่ผมเขียนอ้างค่าคงที่ (`FINE_PER_DAY_CENTS`) ไม่ได้ hardcode ตัวเลข
มันเลย "เลื่อนตาม" ไปด้วย จับไม่ได้

เทสที่จับได้คือเทสที่ **hardcode ตัวเลขคำตอบไว้** (`2500`, `50000`)

> บทเรียน: เทสที่คำนวณคำตอบด้วยสูตรเดียวกับโค้ด = เทสที่พิสูจน์ว่า "โค้ดเท่ากับตัวเอง"
> ต้องมีเทสที่ตรึงตัวเลขจริงไว้อย่างน้อยจุดหนึ่งเสมอ

**revert:** `600` → `500`

---

### เคส C — Coverage gate

มีสองวิธี เลือกตามสถานการณ์

#### C1 — วิธีปลอดภัยสำหรับหน้าเวที (ไม่แตะไฟล์เลย)

```bash
npx jest --selectProjects unit --coverage --coverageThreshold '{"global":{"statements":100}}'
```

**ได้:**

```
Test Suites: 8 passed, 8 total
Tests:       247 passed, 247 total

Jest: Coverage for statements (30.88%) does not meet "global" threshold (100%)
```

exit code = `1`

**ประเด็นที่ให้ดู — จุดสำคัญที่สุดของ demo นี้:**
**เทสผ่านหมด 247/247 แต่ exit code = 1** → job แดง
นี่คือสิ่งที่ coverage gate ทำ: มันไม่สนว่าเทสผ่านไหม มันสนว่าเทส**แตะโค้ดครบไหม**

(ตัวเลข 30.88% เพราะรันแค่ unit อย่างเดียว โค้ดฝั่ง HTTP/DB เลยไม่ถูกแตะ)

ไม่ต้อง revert อะไร เพราะไม่ได้แก้ไฟล์

#### C2 — วิธีสมจริง (ลบเทสทิ้ง)

```bash
mv tests/unit/isbn.test.ts /tmp/ && npm run test:coverage
```

**ได้:** gate **ยังไม่แดง** — domain ตกจาก 99.35% เหลือ 98.05% ซึ่งยังเหนือเกณฑ์ 95%

```
 src/domain     |   98.05 |     94.5 |     100 |   98.05 |
  isbn.ts       |   80.76 |     62.5 |     100 |   80.76 | 8-9,16-17,30-31,42-43,51-52
```

**ประเด็นที่ให้ดู:** `isbn.ts` ร่วงจาก 100% → 80.76% เห็นชัดในตาราง แต่ค่าเฉลี่ยรวมยังผ่าน
เพราะ integration test ก็วิ่งผ่าน domain ด้วย ทำให้ตัวเลขรวมไม่ไวต่อการลบเทสไปหนึ่งไฟล์

> บทเรียน: **coverage % รวม เป็นตัวชี้วัดที่ทื่อ** ให้ดูคอลัมน์รายไฟล์และเลข "บรรทัดที่ไม่ถูกแตะ" ทางขวาแทน

**revert:** `mv /tmp/isbn.test.ts tests/unit/`

---

### เคส D — พังเฉพาะ integration (unit ยังเขียวสนิท)

อันนี้คือเคสที่โชว์ว่า "ทำไมต้องมีเทสสองชั้น" ได้ดีที่สุด

**แก้ที่:** [src/repositories/bookRepository.ts](../src/repositories/bookRepository.ts) ใน `reserveCopy` — เอาการลบจำนวนเล่มออก

```diff
- 'UPDATE books SET available_copies = available_copies - 1 WHERE id = ? AND available_copies > 0'
+ 'UPDATE books SET available_copies = available_copies WHERE id = ? AND available_copies > 0'
```

**รัน unit ก่อน:**

```bash
npm run test:unit
```

```
Test Suites: 8 passed, 8 total
Tests:       247 passed, 247 total
```

เขียวสนิท ✅

**แล้วรัน integration:**

```bash
npm run test:integration
```

```
● /api/loans › borrowing › creates a loan and takes a copy off the shelf
● /api/loans › borrowing › refuses when the last copy is gone
● /api/loans › borrowing › refuses a second copy of the same title for the same member
● concurrent access › gives the single copy to exactly one of ten simultaneous borrowers
● concurrent access › never lets availableCopies go negative
● concurrent access › hands out exactly as many loans as there are copies

Test Suites: 6 failed, 4 passed, 10 total
Tests:       22 failed, 127 passed, 149 total
```

**ประเด็นที่ให้ดู:** บั๊กนี้ทำให้ห้องสมุดปล่อยหนังสือได้ไม่จำกัด — ร้ายแรงมาก
แต่ **unit test 247 ตัวมองไม่เห็นเลยแม้แต่ตัวเดียว** เพราะบั๊กอยู่ใน SQL ไม่ได้อยู่ในตรรกะ

ถ้าโปรเจคมีแต่ unit test ก็จะขึ้น production ไปพร้อมบั๊กนี้

**revert:** ใส่ `- 1` กลับเข้าไป

---

### เคส E — devDependency หลุดเข้า production (แดงที่ job สุดท้ายเท่านั้น)

**แก้ที่:** [src/config.ts](../src/config.ts) เติมบรรทัดบนสุด

```ts
import { rimraf } from 'rimraf';
void rimraf;
```

**รันทีละอย่าง:**

```bash
npm run typecheck    # ผ่าน ✅
npm run build        # ผ่าน ✅
npm test             # ผ่าน ✅ 396/396
```

ทุกอย่างเขียวหมด เพราะในเครื่องเรามี `rimraf` ติดตั้งอยู่ (มันเป็น devDependency)

**แต่ตอน deploy จริง เขาลงแค่ dependencies:**

```bash
npm ci --omit=dev && npm run smoke
```

```
FAIL  could not load ../dist/config.js
      Cannot find module 'rimraf'
Require stack:
- .../dist/config.js
```

exit code = `1`

**ประเด็นที่ให้ดู:** เทส 396 ตัวจับไม่ได้เลย typecheck ก็ไม่จับ build ก็ไม่จับ
มีแต่ job ที่ลง **prod-only แล้วบูตของจริง** ถึงจะเจอ — นี่คือหน้าที่ของ `verify-artifact`

**revert:** ลบสองบรรทัดนั้นออก แล้ว `npm ci && npm run build`

---

### ตารางสรุป — เคสไหนแดงที่ job ไหน

| เคส | typecheck | unit | integration | coverage | verify-artifact |
|---|:---:|:---:|:---:|:---:|:---:|
| A · type error | 🔴 | ⏭ | ⏭ | ⏭ | ⏭ |
| B · เปลี่ยนกฎธุรกิจ | ✅ | 🔴 | 🔴 | 🔴 | ✅ |
| C1 · บังคับ threshold | ✅ | ✅ | ✅ | 🔴 | ✅ |
| D · พัง SQL | ✅ | ✅ | 🔴 | 🔴 | ✅ |
| E · devDep หลุด | ✅ | ✅ | ✅ | ✅ | 🔴 |

⏭ = ไม่ได้รัน เพราะ job ก่อนหน้าตายไปแล้ว

**ประโยคปิด:** แต่ละ job จับคนละอย่าง ไม่มี job ไหนแทน job อื่นได้ — ถ้าตัด job ไหนออก จะมีบั๊กประเภทหนึ่งหลุดทันที

---

## 3. ยิงพร้อมกันสองคน

> "ถ้าหนังสือเหลือเล่มเดียว แล้วสองคนกดยืมพร้อมกัน จะเกิดอะไรขึ้น"

คำตอบสั้น: **มีคนเดียวได้ อีกคนได้ 422** และ `availableCopies` ไม่มีทางติดลบ

มีเทสพิสูจน์อยู่จริงที่ [tests/integration/concurrency.test.ts](../tests/integration/concurrency.test.ts)

```bash
npx jest tests/integration/concurrency.test.ts --runInBand --verbose
```

```
Tests: 6 passed, 6 total
```

### เทส: 10 คนแย่งเล่มสุดท้ายพร้อมกัน

```ts
const responses = await Promise.all(
  members.map((member) =>
    request(app).post('/api/loans').send({ bookId: book.id, memberId: member.id })
  ),
);

expect(responses.filter((r) => r.status === 201)).toHaveLength(1);   // ได้ 1
expect(responses.filter((r) => r.status === 422)).toHaveLength(9);   // ไม่ได้ 9
// ทั้ง 9 คนได้ code เดียวกันคือ NO_COPIES_AVAILABLE
```

### ทำไมถึงปลอดภัย — มีเกราะ 3 ชั้น

**ชั้นที่ 1 — Node ทำทีละคำขอ**

`better-sqlite3` เป็น API แบบ **synchronous** และ Node รัน JS ด้วย thread เดียว
พอ `borrow()` เริ่มทำงาน มันจะทำจนจบก่อน ไม่มีคำขออื่นแทรกกลางคันได้

ชั้นนี้ฟรี แต่ **หายไปทันทีที่คุณรันเกิน 1 instance** — อย่าพึ่งพามันอย่างเดียว

**ชั้นที่ 2 — Transaction**

ทั้งการเช็ค การตัดสต็อก และการสร้าง loan อยู่ใน transaction เดียว
([src/services/loanService.ts](../src/services/loanService.ts))

```ts
return db.transaction(() => {
  ...เช็คกฎทั้งหมด...
  if (!repos.books.reserveCopy(bookId)) { throw new ConflictError(...) }
  const loan = repos.loans.insert({ ... });
  return loan;
})();
```

ถ้าพังกลางทาง SQLite ย้อนคืนทั้งก้อน — มีเทสยืนยันที่ `database.test.ts › rolls back every write when the transaction throws`

**ชั้นที่ 3 — ฐานข้อมูลบังคับเอง (ชั้นที่สำคัญที่สุด)**

การตัดสต็อกเป็น UPDATE ที่มีเงื่อนไขติดมาในตัว SQL เลย:

```sql
UPDATE books SET available_copies = available_copies - 1
WHERE id = ? AND available_copies > 0
```

ถ้าไม่มีเล่มเหลือ `changes = 0` → โค้ดรู้ทันทีว่าแพ้ race แล้ว throw ออกไป

ชั้นนี้ทำงานแม้ **คนละ process คนละเครื่อง** เทสพิสูจน์ด้วยการเปิด 2 connection ไปที่ไฟล์ DB เดียวกัน:

```ts
expect(createBookRepository(alpha).reserveCopy(book.id)).toBe(true);   // คนแรกได้
expect(createBookRepository(bravo).reserveCopy(book.id)).toBe(false);  // คนสองไม่ได้
```

บวกกับ partial unique index ที่กันไม่ให้คนเดียวยืมเล่มเดิมซ้อนกันได้ ([src/db/migrate.ts](../src/db/migrate.ts)):

```sql
CREATE UNIQUE INDEX idx_loans_unique_active
  ON loans(book_id, member_id) WHERE status = 'ACTIVE';
```

ต่อให้ยิงจากคนละ process ตัวที่สองก็จะโดน `UNIQUE constraint failed` — มีเทสยืนยันไว้เช่นกัน

### สาธิตสด (ถ้ามีเวลา)

เปิดเซิร์ฟเวอร์ไว้ใน **terminal แยกอีกหน้าต่าง** (ห้ามรันรวมกับ curl ใน shell เดียว เดี๋ยว `wait` ค้าง):

```bash
npm run seed && npm run dev
```

แล้วเปิด terminal ที่สอง ยิง 3 คำขอพร้อมกันแย่งหนังสือเล่มที่ 5 (มีสำเนาเล่มเดียว):

```bash
for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/api/loans -H "x-api-key: member-secret-key" -H "Content-Type: application/json" -d "{\"bookId\":5,\"memberId\":$i}" & done; wait; echo
```

**ได้จริง:**

```
201 422 422
```

(ลำดับสลับได้ แต่จำนวนคงที่เสมอ: 201 หนึ่งตัว ที่เหลือ 422)

จากนั้นดูสต็อก — ต้องเป็น `0` ไม่ใช่ค่าติดลบ:

```bash
curl -s -H "x-api-key: member-secret-key" localhost:3000/api/books/5
```

```json
{"id":5,"title":"Working Effectively with Legacy Code",
 "totalCopies":1,"availableCopies":0}
```

**ล้างของหลังเลิกใช้:** `rm -f library.db*`

---

## 4. คำถามที่นักเรียนน่าจะถาม

**"ทำไมไม่ใช้ Postgres"**
เพราะ pipeline จะต้องมี service container เพิ่ม ทำให้ CI ช้าลงและพังง่ายขึ้น
โปรเจคนี้เน้นสอน pipeline ไม่ได้เน้นสอน DB — SQLite `:memory:` ให้ transaction จริงและ constraint จริงครบ โดยไม่ต้องตั้งอะไรเลย

**"เทสไม่ flaky เหรอ เรื่องเวลา"**
ไม่ เพราะ service ไม่เรียก `new Date()` เอง แต่รับ `clock` เข้ามา เทสจึงหยุดเวลาแล้วเดินหน้าเองได้
ดู `harness.advanceDays(60)` ใน `lendingFlow.test.ts`

**"ทำไม integration test ต้อง `--runInBand`"**
เพื่อให้รันทีละไฟล์ ไม่แย่ง resource กัน ผลลัพธ์อ่านง่ายและ log ไม่ปนกันใน CI

**"ถ้าเทสผ่านหมดแล้วยังต้องมี coverage gate ทำไม"**
ดูเคส C1 — เทสผ่าน 247/247 แต่ job แดง เพราะเทสไม่ได้แตะโค้ดครึ่งหนึ่งของระบบเลย

---

## 5. ปุ่ม panic (กลับเขียวทันที)

ถ้าอยู่ใน git แล้ว:

```bash
git checkout -- src tests jest.config.js && npm ci && npm test
```

ถ้ายังไม่ได้ commit ให้ไล่ revert ตามที่จดไว้ท้ายแต่ละเคส แล้วยืนยันด้วย:

```bash
npm run typecheck && npm test && npm run build && npm run smoke
```

ต้องได้ครบทั้งสี่บรรทัดนี้:

```
(typecheck เงียบ = ผ่าน)
Tests:       396 passed, 396 total
(build เงียบ = ผ่าน)
OK    compiled build boots, migrates and serves requests
```

> **แนะนำ:** commit ไว้ก่อนขึ้นเวที จะได้กด `git checkout -- .` กลับได้ในวินาทีเดียว
>
> ```bash
> git init && git add . && git commit -m "green baseline before demo"
> ```
