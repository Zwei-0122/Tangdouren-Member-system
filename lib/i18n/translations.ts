// ============================================================
// 双语文案（中文 / English）
// ============================================================

export type Lang = 'zh' | 'en'

export const t = {
  // ── Shared ────────────────────────────────────────────────
  studioName: {
    zh: '糖豆人手工工作室',
    en: 'Jelly Bean Studio',
  },
  studioTagline: {
    zh: '在伦敦，用一颗颗小豆子，\n拼出你独一无二的糖豆人。',
    en: 'In London, craft your own unique\ncreation — one tiny bead at a time.',
  },
  bookNow: {
    zh: '立即预约体验',
    en: 'Book Now',
  },
  address: {
    zh: '地址',
    en: 'Address',
  },
  openingHours: {
    zh: '营业时间',
    en: 'Opening Hours',
  },
  openingHoursValue: {
    zh: '周二至周日 11:00 – 21:00 (GMT/BST)',
    en: 'Tue – Sun  11:00 – 21:00 (GMT/BST)',
  },
  closedMonday: {
    zh: '每周一休息',
    en: 'Closed on Mondays',
  },

  // ── NavBar ─────────────────────────────────────────────────
  navHome:     { zh: '首页',    en: 'Home' },
  navGallery:  { zh: '作品展示', en: 'Gallery' },
  navLocation: { zh: '地点指引', en: 'Location' },
  navPricing:  { zh: '价格',    en: 'Pricing' },
  navFaq:      { zh: 'FAQs',    en: 'FAQs' },
  navBook:     { zh: '立即预约', en: 'Book Now' },

  // ── Footer ─────────────────────────────────────────────────
  footerQuickLinks: { zh: '快捷导航',  en: 'Quick Links' },
  footerContact:    { zh: '联系我们',  en: 'Contact Us' },
  footerInline:     { zh: '在线预约',  en: 'Book Online' },
  footerTimezone:   { zh: '英国时区 GMT/BST', en: 'UK Time GMT/BST' },
  footerCopyright:  { zh: '© 2025 糖豆人手工工作室. All rights reserved.', en: '© 2025 Jelly Bean Studio. All rights reserved.' },
  footerAdmin:      { zh: '管理员入口', en: 'Admin' },

  // ── MobileBookingBar ───────────────────────────────────────
  mobileBook: { zh: '立即预约体验', en: 'Book Now' },

  // ── GalleryGrid ────────────────────────────────────────────
  galleryAll:       { zh: '全部',      en: 'All' },
  galleryFeatured:  { zh: '展示图库',  en: 'Featured' },
  galleryEmpty:     { zh: '该分类暂无作品，敬请期待', en: 'No works in this category yet — check back soon!' },

  // ── Gallery Page ───────────────────────────────────────────
  gallerySectionLabel: { zh: '作品展示', en: 'Our Works' },
  galleryPageTitle:    { zh: '每件作品都是', en: 'Every Piece Is' },
  galleryPageTitleHighlight: { zh: '独一无二', en: 'One of a Kind' },
  galleryPageTitleSuffix: { zh: '的', en: '' },
  galleryPageSubtitle: {
    zh: '银河战舰的最后一块拼图，就差你了！',
    en: 'The galaxy is almost complete — all it\'s missing is you!',
  },
  galleryPageEmpty:    { zh: '作品图库正在整理中', en: 'Gallery coming soon' },
  galleryPageEmptySub: { zh: '敬请期待，更多精彩作品即将上线', en: 'More amazing works on their way' },
  galleryAll2:         { zh: '全部', en: 'All' },

  // ── Homepage Hero ──────────────────────────────────────────
  heroBadge:    { zh: '伦敦拼豆手作体验工作室', en: 'Bead Art Studio · London' },
  heroSubtitle: {
    zh: '我来伦敦只办三件事：\n拼豆，拼豆，\n还是拼豆！',
    en: 'Relax. Create.\nTake something home\nyou\'re truly proud of.',
  },
  heroCta:         { zh: '立即预约体验', en: 'Book Now' },
  heroViewPricing: { zh: '查看价格',    en: 'View Pricing' },
  heroViewGallery: { zh: '查看作品展示', en: 'View Gallery' },
  heroScroll:      { zh: '向下滚动',    en: 'Scroll' },

  // ── Homepage Gallery Section ───────────────────────────────
  homeGallerySectionLabel: { zh: '作品展示', en: 'Our Works' },
  homeGallerySectionTitle: {
    zh: '以下拼豆我将给到夯',
    en: 'These Creations Will Blow Your Mind ✨',
  },
  homeGalleryViewAll:    { zh: '查看全部作品', en: 'View All Works' },
  homeGalleryComingSoon: { zh: '作品展示即将上线', en: 'Gallery Coming Soon' },
  homeGalleryStayTuned:  { zh: '敬请期待', en: 'Stay tuned' },

  // ── Homepage How It Works ──────────────────────────────────
  stepsSectionLabel: { zh: '预约流程', en: 'How It Works' },
  stepsSectionTitle: { zh: '三步开启你的拼豆之旅', en: '3 Easy Steps to Get Started' },
  step1Title: { zh: '选择日期时段', en: 'Pick a Date & Time' },
  step1Desc:  { zh: '浏览可预约日历，选择你心仪的日期与时间段', en: 'Browse our calendar and choose a date and time that suits you' },
  step2Title: { zh: '填写预约信息', en: 'Fill in Your Details' },
  step2Desc:  { zh: '告诉我们你的姓名、联系方式和参与人数', en: 'Tell us your name, email, and how many people are joining' },
  step3Title: { zh: '到店开始创作', en: 'Come & Create!' },
  step3Desc:  { zh: '收到确认后，带着好心情来工作室，一起动手创作！', en: 'After confirmation, come to the studio and start crafting — bring your excitement!' },
  stepsBookBtn: { zh: '马上预约', en: 'Book Now' },

  // ── Homepage Reviews ───────────────────────────────────────
  reviewsSectionLabel: { zh: '客户反馈', en: 'Reviews' },
  reviewsSectionTitle: { zh: '他们说', en: 'What They Say' },

  // ── Homepage Location ──────────────────────────────────────
  locationSectionLabel:  { zh: '找到我们', en: 'Find Us' },
  locationSectionTitle:  { zh: '快来找我们玩吧！', en: 'Come Visit Us!' },
  locationSectionDesc:   {
    zh: '工作室位于伦敦东区 Algate East，交通便利，步行即可到达地铁站。工作时间为英国本地时间（GMT/BST）。',
    en: 'Our studio is in East London, just a short walk from Aldgate East station. We\'re open in UK local time (GMT/BST).',
  },
  locationContact:      { zh: '联系方式', en: 'Contact' },
  locationContactValue: { zh: '扫描下方二维码添加客服微信', en: 'Scan the QR code below to reach us on WeChat' },
  locationQrLabel:      { zh: '扫码添加客服微信', en: 'Scan to add us on WeChat' },
  locationQrSub:        { zh: '随时咨询预约事项\n我们会尽快回复你', en: 'Message us anytime\nWe\'ll reply as soon as possible' },
  locationBookBtn:      { zh: '预约到访', en: 'Book a Visit' },
  locationMapSearch:    { zh: 'Google Map 搜索：', en: 'Search on Google Maps:' },
  locationMapName:      { zh: '糖豆人手作', en: 'Jelly Bean Studio London' },
  locationMapLink:      { zh: '在 Google Maps 查看 →', en: 'View on Google Maps →' },

  // ── Homepage CTA ───────────────────────────────────────────
  ctaTitle:    { zh: '准备好了吗？', en: 'Ready to Create?' },
  ctaSubtitle: { zh: '现在预约，和我们一起用小豆子创造大惊喜', en: 'Book now and make something amazing with us' },
  ctaBtn:      { zh: '立即预约体验', en: 'Book Now' },

  // ── FAQ Page ───────────────────────────────────────────────
  faqValuesLabel:    { zh: '我们的理念', en: 'Our Values' },
  faqValuesTitle:    { zh: '为什么选择我们', en: 'Why Choose Us' },
  faqValue1Title:    { zh: '用心陪伴', en: 'Personal Guidance' },
  faqValue1Desc:     {
    zh: '每一场体验，店员全程在旁指导，确保你能顺利完成心仪的作品，满载而归。',
    en: 'From start to finish, our staff are right by your side — making sure you complete your piece and leave proud.',
  },
  faqValue2Title:    { zh: '创意无限', en: 'Endless Creativity' },
  faqValue2Desc:     {
    zh: '从经典图案到完全定制，我们帮你把任何想象变成拼豆现实。',
    en: 'From classic patterns to fully custom designs, we help turn your imagination into bead art reality.',
  },
  faqValue3Title:    { zh: '温馨环境', en: 'Cosy Atmosphere' },
  faqValue3Desc:     {
    zh: '工作室空间精心布置，让你在创作时感受到家一般的舒适与温暖。',
    en: 'Our studio is carefully decorated to feel warm and welcoming — a home away from home.',
  },
  faqSectionLabel:    { zh: 'FAQs', en: 'FAQs' },
  faqSectionTitle:    { zh: '常见问题', en: 'Frequently Asked Questions' },
  faqSectionSubtitle: {
    zh: '有什么不确定的？这里可能已经有你想要的答案。',
    en: 'Not sure about something? You might find the answer right here.',
  },
  faqCtaText: {
    zh: '还有其他问题？欢迎直接预约，我们到时候当面聊！',
    en: 'Still have questions? Come for a booking — we can chat in person!',
  },
  faqCtaBtn: { zh: '立即预约体验', en: 'Book Now' },

  // ── FAQ Q&A ────────────────────────────────────────────────
  faqQ1: { zh: '需要提前准备什么吗？', en: 'Do I need to prepare anything in advance?' },
  faqA1: {
    zh: '什么都不需要！所有材料（珠板、拼豆、熨斗等）工作室都会提供，你只需要带上好心情来就好。',
    en: 'Nothing at all! All materials (pegboards, beads, iron, etc.) are provided by the studio. Just bring yourself and good vibes!',
  },
  faqQ2: { zh: '适合小朋友参加吗？', en: 'Is it suitable for children?' },
  faqA2: {
    zh: '建议 6 岁以上的小朋友参加，需要家长全程陪同。10 岁以上可以独立完成大部分作品。',
    en: 'We recommend ages 6 and above. Children must be accompanied by a parent or guardian throughout. Most kids 10+ can complete works independently.',
  },
  faqQ3: { zh: '多人组团来可以一起预约吗？', en: 'Can a group book together?' },
  faqA3: {
    zh: '当然可以！每个时段最多接受 4 人同时体验，预约时填写人数，我们会为同组安排相邻位置。',
    en: 'Absolutely! We can accommodate up to 4 people per session. Just enter your group size when booking and we\'ll seat you together.',
  },
  faqQ4: { zh: '作品当天可以带走吗？', en: 'Can I take my work home on the day?' },
  faqA4: {
    zh: '大部分作品当场完成后即可带走。图案较复杂时可能需要额外熨烫时间，我们会提前告知。',
    en: 'Most works can be taken home on the same day. For more complex designs that need extra ironing time, we\'ll let you know in advance.',
  },
  faqQ5: { zh: '预约后可以取消或改期吗？', en: 'Can I cancel or reschedule my booking?' },
  faqA5: {
    zh: '可以！请至少提前 12 小时联系我们修改或取消预约，超时取消可能无法退还定金（如有）。',
    en: 'Yes! Please contact us at least 12 hours before your session to reschedule or cancel. Late cancellations may not be eligible for a deposit refund (if applicable).',
  },
  faqQ6: { zh: '零基础也能完成作品吗？', en: 'Can I do it with zero experience?' },
  faqA6: {
    zh: '完全没问题！拼豆不需要任何美术基础，我们提供丰富的图案模板供选择，店员全程在旁协助。',
    en: 'Absolutely! No artistic skills required. We offer plenty of patterns to choose from, and our staff will be with you every step of the way.',
  },
  faqQ7: { zh: '可以带自己设计的图案来吗？', en: 'Can I bring my own design?' },
  faqA7: {
    zh: '当然欢迎！你可以提前将图案发给我们确认可行性，或当天带来，我们帮你转换成拼豆图纸。',
    en: 'Of course! Feel free to send your design in advance so we can check feasibility, or bring it on the day — we\'ll convert it into a bead pattern for you.',
  },
  faqQ8: { zh: '工作室在哪里，怎么去？', en: 'Where is the studio and how do I get there?' },
  faqA8: {
    zh: 'Unit 226, 65-75 Whitechapel Road, London E1 1DU。步行即可到达 Aldgate East 地铁站，交通非常方便。',
    en: 'Unit 226, 65-75 Whitechapel Road, London E1 1DU. Just a short walk from Aldgate East tube station — very easy to reach!',
  },

  // ── Location Page ──────────────────────────────────────────
  locationPageBadge:     { zh: '地点指引', en: 'Location Guide' },
  locationPageTitle:     { zh: '如何找到我们', en: 'How to Find Us' },
  locationPageNote:      { zh: 'Aldgate East 地铁站步行约 3 分钟', en: 'About 3 min walk from Aldgate East station' },
  locationPageNavBtn:    { zh: '在 Google Maps 导航', en: 'Navigate on Google Maps' },
  locationPageArrived:   { zh: '✅ 到达目的地！欢迎光临糖豆人手工工作室', en: '✅ You\'ve Arrived! Welcome to Jelly Bean Studio' },
  locationPageContactTitle:    { zh: '如果有任何问题，请联系客服', en: 'Need Help Finding Us?' },
  locationPageContactSubtitle: { zh: '我们很乐意为你提供详细的到店指引', en: 'We\'re happy to guide you step by step' },
  locationPageQrLabel:   { zh: '扫码添加客服微信', en: 'Scan to add us on WeChat' },
  locationPageQrSub:     { zh: '随时咨询，我们尽快回复', en: 'Message us anytime' },
  locationPageBookBtn:   { zh: '立即预约体验', en: 'Book Now' },

  // ── Location Steps ─────────────────────────────────────────
  locationStep1: {
    zh: '从 Aldgate East 地铁站出口出来，沿 Whitechapel Road 向东走',
    en: 'Exit Aldgate East station and head east along Whitechapel Road',
  },
  locationStep2: {
    zh: '沿街道继续前行，留意路边建筑',
    en: 'Continue along the street, keeping an eye on the buildings',
  },
  locationStep3: {
    zh: '找到 65 Whitechapel Road 大楼入口，使用呼机拨打 226（周末或节假日可能需要等待店员下来接您）',
    en: 'Find the entrance to 65 Whitechapel Road and use the intercom to dial 226 (on weekends or holidays you may need to wait for staff to come down)',
  },
  locationStep4: {
    zh: '进入大楼后按指引前往 Unit 226',
    en: 'Once inside, follow the signs to Unit 226',
  },
  locationStep5: {
    zh: '到达工作室门口，店员将会在这里接待您！',
    en: 'You\'ve reached the studio door — our team will be here to welcome you!',
  },
  // ── Pricing Page ───────────────────────────────────────────
  pricingBadge:  { zh: '价格表', en: 'Pricing' },
  pricingTitle:  { zh: '价格表', en: 'Pricing' },
  pricingSubtitle: {
    zh: '计时收费，材料工具全包，到店结清即可。',
    en: 'Charged by time, all materials included — just pay at the studio.',
  },
  pricingImageAlt: { zh: '价格表', en: 'Price list' },
  pricingCta:   { zh: '立即预约体验', en: 'Book Now' },

  // ── Booking Page ───────────────────────────────────────────
  bookingPageLabel:    { zh: '在线预约', en: 'Book Online' },
  bookingPageTitle:    { zh: '预约你的拼豆时光', en: 'Book Your Bead Art Session' },
  bookingHours:        { zh: '营业时间', en: 'Opening hours' },
  bookingHoursUnit:    { zh: '（英国时间）', en: ' (UK time)' },

  bookingPendingTitle: { zh: '你有一笔待支付的预约', en: 'You have a pending payment' },
  bookingPendingPay:   { zh: '继续支付', en: 'Continue Payment' },

  stepDate:   { zh: '选日期',  en: 'Date' },
  stepParty:  { zh: '选人数',  en: 'Group' },
  stepSlots:  { zh: '选时段',  en: 'Slots' },
  stepForm:   { zh: '填信息',  en: 'Details' },

  // Step 1 – Date
  bkStep1Title:        { zh: '选择预约日期',    en: 'Choose a Date' },
  step1TodayBadge:     { zh: '🇬🇧 伦敦时间',   en: '🇬🇧 London Time' },
  step1Today:          { zh: '今日：',           en: 'Today: ' },
  step1Loading:        { zh: '加载中…',          en: 'Loading…' },
  step1TodayMarker:    { zh: '今',               en: 'T' },
  step1LegendAvail:    { zh: '可预约',           en: 'Available' },
  step1LegendSel:      { zh: '已选',             en: 'Selected' },
  step1LegendDim:      { zh: '不可选',           en: 'Unavailable' },
  step1Next:           { zh: '下一步：选择人数', en: 'Next: Group Size' },

  weekdays: {
    zh: ['日','一','二','三','四','五','六'],
    en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  },
  months: {
    zh: ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'],
    en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  },

  // Step 2 – Party
  step2BackBtn:        { zh: '返回修改日期',    en: '← Change Date' },
  bkStep2Title:        { zh: '选择人数',         en: 'Group Size' },
  step2ShareTitle:     { zh: '接受拼桌',         en: 'Join a shared table' },
  step2Share1Desc:     { zh: '允许升级到双人桌，可与另一位单人客户共享', en: 'May share a double table with another solo guest' },
  step2Share2Desc:     { zh: '允许升级到四人桌，可与另一组双人客户共享', en: 'May share a four-person table with another pair' },
  step2GalleryBtn:     { zh: '查看作品大小与预计时长参考', en: 'Browse works for size & time reference' },
  step2Next:           { zh: '下一步：查看可约时段', en: 'Next: View Available Slots' },

  party1Label: { zh: '1 人',   en: '1 person' },
  party1Sub:   { zh: '单人体验', en: 'Solo' },
  party2Label: { zh: '2 人',   en: '2 people' },
  party2Sub:   { zh: '双人同乐', en: 'Duo' },
  party3Label: { zh: '3-4 人', en: '3-4 people' },
  party3Sub:   { zh: '小组活动', en: 'Group' },

  // Step 3 – Slots
  step3BackBtn:        { zh: '返回修改人数',    en: '← Change Group Size' },
  bkStep3Title:        { zh: '选择时段',         en: 'Choose a Time Slot' },
  step3Refresh:        { zh: '刷新',             en: 'Refresh' },
  step3Persons:        { zh: '人',               en: '' },
  step3Sharing:        { zh: ' · 接受拼桌',      en: ' · Shared table' },
  step3Loading:        { zh: '加载可用时段中…',  en: 'Loading available slots…' },
  step3Empty:          { zh: '该日期暂无可约时段', en: 'No slots available on this date' },
  step3EmptySub:       { zh: '请尝试换个日期，或开启拼桌选项', en: 'Try a different date or enable shared tables' },
  step3Phase1:         { zh: '① 选择开始时间',  en: '① Choose start time' },
  step3Phase2Prefix:   { zh: '② ',              en: '② Starting at ' },
  step3Phase2Suffix:   { zh: ' 开始，选择时长', en: ', choose duration' },
  step3SharedDot:      { zh: '绿点表示该时段有拼桌选项', en: 'Green dot indicates a shared table option is available' },
  step3Selected:       { zh: '已选：',           en: 'Selected: ' },
  step3Start:          { zh: ' 开始，',          en: ' start, ' },
  step3Next:           { zh: '下一步：填写信息', en: 'Next: Your Details' },

  durationHour:   { zh: '小时',  en: ' hr' },
  durationHours:  { zh: '小时',  en: ' hrs' },
  partyPersons34: { zh: '3-4',   en: '3-4' },
  acceptsSharing: { zh: '（接受拼桌）', en: ' (shared)' },

  // Step 4 – Form
  step4BackBtn:      { zh: '返回修改时段',   en: '← Change Slot' },
  step4Title:        { zh: '填写预约信息',   en: 'Your Details' },
  step4NameLabel:    { zh: '姓名 *',         en: 'Name *' },
  step4NamePH:       { zh: '请填写您预定的姓名', en: 'Enter the name for the booking' },
  step4NameErr:      { zh: '请输入姓名',     en: 'Please enter your name' },
  step4EmailLabel:   { zh: '邮箱 *',         en: 'Email *' },
  step4EmailPH:      { zh: '请输入邮箱地址，如 example@mail.com', en: 'e.g. example@mail.com' },
  step4EmailErr:     { zh: '请输入邮箱地址', en: 'Please enter your email' },
  step4EmailFmtErr:  { zh: '请输入有效的邮箱格式，如 example@mail.com', en: 'Please enter a valid email address' },
  step4RemarkLabel:  { zh: '备注（可选）',   en: 'Notes (optional)' },
  step4RemarkPH:     { zh: '如：有小朋友一起来、希望座位靠窗…', en: 'e.g. bringing a child, prefer a window seat…' },
  step4SummaryTitle: { zh: '预约摘要',       en: 'Booking Summary' },
  step4SummaryDate:  { zh: '📅 日期：',      en: '📅 Date: ' },
  step4SummaryTime:  { zh: '⏰ 开始：',      en: '⏰ Start: ' },
  step4SummaryDur:   { zh: '，时长 ',        en: ', duration ' },
  step4SummaryTable: { zh: '🪑 桌型：',      en: '🪑 Table: ' },
  step4SummaryGroup: { zh: '👥 人数：',      en: '👥 Group: ' },
  step4SummaryUnit:  { zh: ' 人',            en: '' },
  step4DepositOff:   { zh: '✅ 提交后名额立即锁定，无需支付定金，到店结清即可', en: '✅ Your spot is confirmed instantly — no deposit required, just pay on arrival' },
  step4Submitting:   { zh: '处理中…',        en: 'Processing…' },
  step4Submit:       { zh: '确认预约',        en: 'Confirm Booking' },
  step4JoinClub:     { zh: '顺便加入糖豆人会员', en: 'Also join Tangdouren Membership' },
  step4JoinClubHint: { zh: '每次到店计时都累积进度：满 2 次 £2 抵用券，满 5 次 £5，满 8 次本人 85 折加朋友 9 折，满 10 次送一张 VIP 月卡。不想加入也能直接预约。', en: 'Every in-store visit builds progress: 2 visits for a £2 voucher, 5 for £5, 8 for 15% off for you and 10% off for a friend, 10 for a VIP Month. Joining is optional.' },
  step5MemberJoined: { zh: '✅ 你已加入糖豆人会员，到店扫码后就能用自己的手机看到进度。', en: '✅ You have joined Tangdouren Membership — scan in store to track your progress on your phone.' },
  step4NetworkErr:   { zh: '网络错误，请检查连接后重试', en: 'Network error, please check your connection and try again' },

  // Step 5 – Done
  step5Title:       { zh: '预约成功！',      en: 'Booking Confirmed!' },
  step5Subtitle:    { zh: '您的预约已自动确认，名额已为您锁定。', en: 'Your booking is confirmed — your spot is reserved.' },
  step5SubNote:     { zh: '如需变更或取消，请通过联系方式告知工作室。', en: 'To change or cancel, please contact the studio.' },
  step5DetailsTitle:{ zh: '您的预约详情',    en: 'Your Booking Details' },
  step5Ref:         { zh: '编号：',          en: 'Ref: ' },
  step5LocationPre: { zh: '在出发前请详情查看', en: 'Before you head out, check the ' },
  step5LocationBtn: { zh: '地点指引',        en: 'Location Guide' },
  step5LocationPost:{ zh: '找到我们！',      en: ' to find us!' },
  step5Again:       { zh: '再次预约',        en: 'Book Again' },

  // Slot load error
  slotsLoadErr: { zh: '加载失败，请重试', en: 'Failed to load, please try again' },
} as const

// Helper – pick the right language string
export function pick(entry: { zh: string; en: string }, lang: Lang): string {
  return entry[lang]
}

// Special helpers for array entries
export function pickArr(entry: { zh: readonly string[]; en: readonly string[] }, lang: Lang): readonly string[] {
  return entry[lang]
}
