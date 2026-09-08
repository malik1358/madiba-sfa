# MADIBA SFA — Tablet Hardware Specification (Vendor Brief)

**Document purpose:** Give this sheet to tablet vendors / IT suppliers so they can propose devices for our field sales team in **Saudi Arabia (KSA)**.

**Application:** MADIBA SFA (Sales Force Automation)  
**Platform direction:** Native **Android** app (Google Play / APK)  
**Usage:** Full-day field work — customer visits, orders, collections, GPS tracking, photo capture  
**Connectivity target:** **5G** (with LTE fallback) + **fully offline-capable** operation when coverage is weak or unavailable  

---

## 1. Business use case (read this first)

Each salesman carries one company tablet all day across shops, warehouses, and roads in KSA.

The app must:

| Function | Why it matters for hardware |
| --- | --- |
| Login / attendance / My Day | All-day reliability, good battery |
| Customer list, orders, pricing, schemes | Enough RAM + storage for local offline data |
| Payment collections + receipt / payment photos | Rear camera + storage for queued images |
| Customer documents / invoice photos | Camera quality + storage |
| Background GPS field tracking | Real GPS chip + cellular modem + strong battery policy support |
| Push / lock-screen alerts | Stable Android notifications |
| Work with weak or no internet | Local storage large enough for offline catalog + queued transactions |
| Sync when 5G/LTE returns | Reliable cellular modem (not Wi‑Fi only) |

**Do not propose iPad / iOS.** The app is Android-only.

**Do not propose Wi‑Fi-only tablets.** Salesmen work outdoors and need SIM data + GPS.

---

## 2. Mandatory requirements (must meet)

### 2.1 Operating system

| Spec | Requirement |
| --- | --- |
| OS | **Android only** |
| Minimum Android version | **Android 12** or newer (Android 13+ preferred) |
| Google services | **Google Play Services** required (Play Store, Maps/location, Firebase push) |
| OEM skin | Prefer Samsung / Google-friendly OEMs with predictable battery & permission settings |
| OS update support | At least **3 years** security updates from purchase date |

### 2.2 Network & SIM (critical)

| Spec | Requirement |
| --- | --- |
| Cellular | **5G** required (NSA/SA as available in KSA) |
| Fallback | **4G LTE** must work on STC / Mobily / Zain KSA bands |
| SIM | **Nano-SIM** (dual SIM optional, not required) |
| eSIM | Nice to have, not required |
| Wi‑Fi | Wi‑Fi 5 (802.11ac) minimum; Wi‑Fi 6 preferred |
| Bluetooth | Bluetooth 5.0+ |
| Wi‑Fi-only models | **Not accepted** |

### 2.3 Location / GPS (critical for MADIBA)

| Spec | Requirement |
| --- | --- |
| GNSS | Dedicated GPS (GPS + GLONASS minimum; Galileo / BeiDou preferred) |
| Accuracy | Outdoor accuracy suitable for visit check-in (typically **≤ 10–20 m** in open sky) |
| Background location | Must support Android **“Allow all the time”** location permission |
| Assisted location | A-GPS / network location via 5G/LTE |
| Indoor / weak signal | Must still obtain a fix outdoors within a reasonable time (target **≤ 30–60 seconds**) |

> MADIBA runs a foreground location service during the workday. Devices that aggressively kill background GPS are **not suitable**.

### 2.4 Performance & memory (offline-ready)

| Spec | Minimum | Recommended for fleet |
| --- | --- | --- |
| RAM | **6 GB** | **8 GB** |
| Internal storage | **128 GB** | **128–256 GB** |
| Expandable storage | microSD optional but preferred | microSD up to 1 TB preferred |
| CPU | Mid-range octa-core (e.g. Snapdragon 6/7 series or equivalent) | Snapdragon 7-series / Dimensity 7000-class or better |
| GPU / WebView | Smooth scrolling of large customer & item lists | Same |

**Why storage/RAM matter:**  
We are moving to a **fully offline Android app**. Each device will keep local copies of customers, prices, schemes, outstanding invoices, and a queue of orders/collections/photos until 5G/LTE sync. 64 GB fills quickly with photos + offline cache.

### 2.5 Display

| Spec | Requirement |
| --- | --- |
| Size | **10.5" – 11.5"** preferred (absolute minimum **10.1"**) |
| Resolution | **1920 × 1200** or better |
| Brightness | Usable outdoors — target **≥ 400 nits** (500+ preferred) |
| Touch | Works with light gloves / sweaty fingers preferred |
| Orientation | Portrait + landscape both supported |

> Avoid 8.0"–8.7" “mini” tablets — order / collection screens are too cramped for daily field use.

### 2.6 Camera & media

| Spec | Minimum | Recommended |
| --- | --- | --- |
| Rear camera | **8 MP** with autofocus | **13 MP+** autofocus |
| Front camera | 5 MP | 5–8 MP |
| Flash | LED flash preferred | LED flash |
| Document capture | Sharp enough for invoices, cheques, receipts, CR copies | Same |
| Video | 1080p optional | 1080p |

### 2.7 Battery & power (full field day)

| Spec | Requirement |
| --- | --- |
| Battery capacity | **≥ 7,000 mAh** (preferred **≥ 8,000 mAh**) |
| Runtime target | **10–12 hours** mixed use with GPS + 5G + screen on during visits |
| Charging | USB‑C |
| Fast charging | Preferred (25W+ if available) |
| Removable battery | Optional (useful for rugged models) |
| Battery optimization | Must allow **Unrestricted / ignore battery optimization** for MADIBA |

> Devices that force-kill background apps after a few minutes are rejected.

### 2.8 Durability (field conditions in KSA)

| Spec | Minimum | Preferred |
| --- | --- | --- |
| Build | Solid plastic/metal consumer tablet + protective case | Rugged / semi-rugged |
| Drop protection | Case that survives **1.2 m** drops onto concrete | MIL-STD-810H |
| Dust / water | Prefer IP52+ with case | IP68 preferred for warehouse/van use |
| Operating temperature | Reliable in **hot vehicle / outdoor KSA summer** (target up to ~45–50°C ambient exposure with shade/case) | Same |
| Screen protection | Tempered glass film included in quote | Gorilla Glass |

Every quote should include:

1. Rugged or reinforced protective case  
2. Screen protector  
3. USB‑C car charger or high-quality wall charger  
4. Optional: vehicle mount / hand strap  

### 2.9 Audio / sensors / extras

| Spec | Requirement |
| --- | --- |
| Speakers | Stereo preferred |
| Mic | Clear enough for support calls |
| Accelerometer / sensors | Standard Android sensors |
| NFC | Optional |
| Fingerprint / face unlock | Preferred for fast salesman login unlock of device |
| Ports | USB‑C data transfer |

---

## 3. Software / MDM compatibility

Vendors should confirm the proposed tablet supports:

| Item | Requirement |
| --- | --- |
| Google Play Store | Yes (install MADIBA from Play internal testing / production) |
| Sideload APK | Allowed if needed for UAT |
| Samsung Knox / Android Enterprise | Preferred for company fleet control |
| MDM | Compatible with common MDM (e.g. Knox Manage, Intune, Hexnode, etc.) |
| Permissions | Location all-the-time, Camera, Notifications, Files/Photos, Battery unrestricted |
| Multi-user / guest | Not required |
| Language | Device UI supports **English + Arabic** |

---

## 4. Offline + 5G sync expectations (for sizing)

Design assumption for each salesman tablet:

| Data kept on device | Approx. planning allowance |
| --- | --- |
| App + Android system free space | Reserve **20–30 GB** free always |
| Offline master data (customers, prices, schemes, invoices) | Plan **2–8 GB** depending on territory size |
| Queued photos / PDFs / receipts before sync | Plan **5–15 GB** peak |
| Growth / updates / cache | Extra headroom |

**Fleet rule of thumb:**  
**128 GB minimum**, **256 GB** if the salesman covers a large customer book or captures many documents daily.

Offline mode requirements implied for hardware:

- Enough RAM to keep app responsive while writing local queue  
- Stable storage (no failing cheap eMMC that corrupts offline DB)  
- Cellular modem that reconnects cleanly after tunnels / elevators / desert roads  
- GPS that continues during offline periods (location still recorded locally)

---

## 5. Acceptance tests (vendor / IT must pass before bulk order)

Please provide **2–3 sample units** for UAT. We will reject the model if any critical test fails.

### Critical tests

1. **Install MADIBA** from Play / APK and complete login.  
2. Set **Location → Allow all the time** and **Battery → Unrestricted**.  
3. Insert KSA SIM (STC / Mobily / Zain) and confirm **5G or LTE data**.  
4. Outdoor **GPS fix** within 60 seconds; background ping still works with screen off for 30+ minutes.  
5. Capture **10 receipt photos** and confirm files are clear and saved.  
6. Enable airplane mode and confirm app can still open customers / draft order / queue a collection (offline).  
7. Disable airplane mode and confirm queued data **syncs over 5G/LTE**.  
8. Run mixed use for **full workday** (or 8+ hours lab simulation) without forced app kill.  
9. Confirm Arabic + English UI and correct KSA timezone.  
10. Confirm device does **not** overheat unusable in a parked car dashboard test (shade recommended; still must remain operable).

---

## 6. What to propose (vendor response format)

Please reply with a short comparison table for **2–3 Android 5G tablets**, using this format:

| Field | Your answer |
| --- | --- |
| Model name + exact SKU | |
| Android version (shipped) | |
| Chipset | |
| RAM / Storage | |
| Display size / resolution / brightness | |
| 5G bands supported (KSA) | |
| GPS / GNSS systems | |
| Battery capacity + claimed hours | |
| Rear camera | |
| IP / MIL rating | |
| Weight | |
| Warranty in KSA | |
| Unit price (SAR, VAT included) | |
| Bulk price for __ units | |
| Case + charger included? | |
| Availability / lead time in KSA | |
| MDM / Knox support | |
| Recommended accessories | |

Also state clearly:

- Confirmed **cellular 5G model** (not Wi‑Fi)  
- Confirmed **Google Play Services**  
- Confirmed device can disable aggressive battery killing for one app  

---

## 7. Our preferred commercial target (guidance, not a hard lock)

For rolling out to **all salesmen**, we usually prefer:

| Priority | Guidance |
| --- | --- |
| Best balance | Mid-range **11" Android 5G** tablet, **8 GB / 128 GB**, strong GPS, ≥7000 mAh |
| Example class already known in KSA retail | Samsung Galaxy Tab A9+ **5G** class or newer equivalent |
| Premium / high-breakage routes | Rugged tablet (e.g. Galaxy Tab Active class) if drop damage is high |
| Avoid | Wi‑Fi only, iPad, <10" screens, 3–4 GB RAM, 64 GB storage, no Google Play |

Budget target for standard fleet unit (tablet only, before case):  
**aim for value mid-range**, not flagship. Flagship tablets are unnecessary for MADIBA.

---

## 8. Quantity & rollout notes

- Devices will be **company-owned** and assigned 1 per salesman/collector.  
- All devices should be the **same model** for support simplicity.  
- Quote optional spare pool: **+10%** units.  
- Include warranty / replacement SLA for KSA (Riyadh / Jeddah / Dammam coverage preferred).  

---

## 9. Contact checklist for vendor meeting

Bring / email:

1. This specification  
2. Your 2–3 model proposals with prices  
3. Datasheets PDF  
4. Sample unit availability date  
5. Bulk discount tiers (10 / 25 / 50 / 100 units)

---

## 10. One-page summary (print this)

**MADIBA SFA field tablet — must have**

- Android 12+ with Google Play  
- **5G + LTE** nano-SIM (Wi‑Fi only rejected)  
- Strong **GPS** + background location  
- **6–8 GB RAM**, **128 GB+** storage  
- **10.5–11.5"** bright display  
- **8 MP+** rear camera with autofocus  
- **≥ 7,000 mAh**, USB‑C, all-day battery with GPS on  
- Stable for **offline use** + sync when network returns  
- Protective case for KSA field / van use  
- English + Arabic  

**App goal:** Fully offline Android field app, syncing over **5G** when available.

---

*Internal reference: MADIBA SFA Android Capacitor app — GPS foreground tracking, camera uploads, offline sync queue, push notifications. Prepared for tablet procurement in Kingdom of Saudi Arabia.*
