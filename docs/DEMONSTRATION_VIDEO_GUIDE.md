# Bright Riders School — SmartCanteen Demonstration Video Storyboard & Narration Script

This production guide covers all **10 required scenes** using the real **Bright Riders SmartCanteen** web application for school exhibitions and stakeholder presentations.

> **Important Note on Scene 3 (Official Menu Integration):**  
> In accordance with project rules (*"Do not invent food items or prices"* and *"It must not show imaginary features or screens"*), import the official Bright Riders School Canteen Menu first so Scene 3 and Scene 4 showcase the exact school food items and AED prices.

---

## Complete 10-Scene Storyboard & Voiceover Script (~3 Minutes)

### Scene 1 — Introduction (0:00 – 0:20)
- **On-Screen Visual**: Split-screen landing page of **Bright Riders School SmartCanteen** showcasing the school crest, Abu Dhabi campus badge, and the five role portals.
- **Narration**:
  > *"Welcome to Bright Riders School's SmartCanteen — our digital canteen ordering and cashless payment platform. Previously, parents struggled to track changing canteen menus, students carried physical cash that could be lost or forgotten, and canteen staff faced crowded break-time queues. SmartCanteen connects parents, students, teachers, chefs, and administrators in one secure, cashless system."*

### Scene 2 — Parent Login & Linked Children (0:20 – 0:38)
- **On-Screen Visual**: Sign in as `parent.fatima` on the Portal Sign-In form. Navigate to **Family & Profile** showing linked children **Zayed Al Mansoori (Grade 5-A)** and **Mariam Al Mansoori (Grade 8-B)** along with their Student IDs and dietary notes.
- **Narration**:
  > *"Parents sign in securely to their dedicated portal, where they can manage their contact details and access profiles for each of their enrolled children, including class details and allergy alerts."*

### Scene 3 — Official Canteen Menu Browsing (0:38 – 0:58)
- **On-Screen Visual**: Open the **Canteen Menu** tab. Filter through official Bright Riders categories, use the live search bar and Vegetarian filter, and inspect food descriptions and exact prices in UAE Dirhams (`AED`).
- **Narration**:
  > *"From the Canteen Menu tab, parents browse the latest official Bright Riders School menu, organised clearly by category with descriptions, dietary indicators, scheduled date availability, and exact prices in UAE Dirhams."*

### Scene 4 — Placing an Advance Meal Order (0:58 – 1:20)
- **On-Screen Visual**: Select **Zayed Al Mansoori (Grade 5-A)** in the top child selector bar, choose the ordering date and **Primary Lunch Break (12:00 PM – 12:40 PM)** collection slot, add menu items to the cart, open **Order Cart**, enter a special kitchen instruction, and review the itemized total.
- **Narration**:
  > *"Ordering takes seconds. Parents select which child the meal is for, choose an ordering date and break collection slot, add items to the persistent cart, include any special kitchen instructions, and review the itemised total."*

### Scene 5 — Digital AED Payment & Confirmation (1:20 – 1:40)
- **On-Screen Visual**: Complete digital checkout in AED. Show the green **Digital Payment Confirmed** screen displaying the unique Order ID (`BRS-...`), transaction reference (`TXN-BRS-...`), and button to open the child's QR Pass.
- **Narration**:
  > *"At checkout, parents complete a secure digital payment in AED. Immediately upon confirmation, SmartCanteen generates a unique transaction receipt, Order ID, and a cryptographically signed QR code."*

### Scene 6 — Student Dashboard & Cashless QR Pass (1:40 – 1:58)
- **On-Screen Visual**: Sign in as `student.zayed` on a mobile viewport. Show the **Cashless Student Dining Pass** header, the upcoming pre-paid order with food quantities and break time, and click **Display Order QR Code for Collection** to reveal the crisp QR code modal.
- **Narration**:
  > *"On the Student Dashboard, Zayed views his upcoming meal, collection break time, and live preparation status — and opens his unique Order QR Code at the counter without carrying a single dirham of physical cash."*

### Scene 7 — Chef Dashboard & Kitchen Preparation (1:58 – 2:18)
- **On-Screen Visual**: Sign in as `chef.rashid` on a tablet viewport. Show incoming paid orders grouped by collection break slot, allergy & special-instruction callouts, and click **Mark as Preparing** followed by **Ready for Collection** (showing the Student Dashboard status stepper updating in real time).
- **Narration**:
  > *"Meanwhile, in the tablet-optimised Chef Dashboard, kitchen staff see incoming paid orders organised by break time, complete with special instructions and allergy alerts. With one tap, the chef marks the meal as Preparing and then Ready for Collection — updating the student and parent dashboards in real time."*

### Scene 8 — Live Camera QR Scanning & Collection Confirmation (2:18 – 2:42)
- **On-Screen Visual**: Chef clicks the prominent **Scan QR Code** button, scans Zayed's QR pass, views the verified order details screen (*"Order verified successfully. Ready for collection confirmation."*), and clicks **Confirm Collection**. Briefly demonstrate scanning the same QR code a second time to show the automatic *"This order has already been collected."* safeguard.
- **Narration**:
  > *"When Zayed arrives at the counter, the chef taps Scan QR Code and scans Zayed's pass. SmartCanteen instantly verifies payment and retrieves the exact order items from the database. One tap on Confirm Collection records the handover and permanently locks the QR code so an order can never be collected twice."*

### Scene 9 — Administrator Dashboard & Analytics (2:42 – 3:02)
- **On-Screen Visual**: Sign in as `admin`. Tour **Overview Dashboard** (14-day AED revenue chart & popular items), **User Management** (all 5 roles & parent-child links), **Menu Management** (editing prices & date schedules), **Payment Management**, and **Reports & Analytics** (exporting CSV reports).
- **Narration**:
  > *"Administrators retain complete oversight — managing accounts across all five roles, updating menu items and date schedules, monitoring payments and refunds, and exporting daily, weekly, and class-wise sales reports."*

### Scene 10 — Conclusion (3:02 – 3:18)
- **On-Screen Visual**: Return to the Bright Riders SmartCanteen crest and summary highlights.
- **Narration**:
  > *"Bright Riders SmartCanteen delivers convenient pre-ordering for parents, 100% cashless meal collection for students, organised preparation for chefs, and transparent management for school leadership — ready for campus adoption."*

---

## Recording Instructions for Exhibition Presentation
1. Start the application (`npm run dev`) and open the Live Preview URL over HTTPS (enables live WebRTC camera access in Scene 8).
2. Use OBS Studio, macOS QuickTime Screen Recording, or Windows Snipping Tool Video Recorder at **1920×1080 (60 fps)**.
3. Keep two browser windows side by side during Scenes 6–8 (Mobile viewport `390×844` for Student QR Pass + Tablet viewport `1024×768` for Chef KDS & Scanner) to showcase real-time status updates and live QR scanning.
