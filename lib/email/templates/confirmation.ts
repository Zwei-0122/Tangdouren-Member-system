// ============================================================
// 预约确认邮件模板（中英双语）
// ============================================================
import { formatGBP } from '@/lib/payment/depositConfig'

export interface ConfirmationEmailData {
  customerName:    string
  bookingDate:     string   // "YYYY-MM-DD"
  startTime:       string   // "HH:MM"
  endTime:         string   // "HH:MM"
  tableDisplay:    string
  partySize:       number
  depositAmount:   number   // 便士
  cancelUrl:       string
  studioName:      string
  studioAddress:   string
  studioEmail:     string
  studioMapUrl?:   string
  lang?:           'zh' | 'en'
  /** 这次预约同时加入了糖豆人会员（PRD 2.3）。英文版暂不开放会员，因此只写中文那一句 */
  memberJoined?:   boolean
}

export function buildConfirmationEmail(data: ConfirmationEmailData): {
  subject: string
  html: string
} {
  const {
    customerName, bookingDate, startTime, endTime,
    tableDisplay, partySize, depositAmount, cancelUrl,
    studioName, studioAddress, studioEmail,
    studioMapUrl = 'https://maps.google.com/?q=糖豆人手作',
    lang = 'zh',
    memberJoined = false,
  } = data

  const locationUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.tangdouren.co.uk'}/location`
  const isEn = lang === 'en'

  const subject = isEn
    ? `🎉 Booking Confirmed! ${bookingDate} ${startTime} — ${studioName} | 📍 Map Included`
    : `🎉 预约成功！${bookingDate} ${startTime} — ${studioName} | 📍 附地图指引`

  const greeting = isEn
    ? `Hi ${customerName}!<br />Your bead art session is confirmed — we can't wait to see you ✨`
    : `你好，${customerName}！<br />你的拼豆体验名额已确认，期待与你相见 ✨`

  const labelDate    = isEn ? '📅 Date'          : '📅 日期'
  const labelTime    = isEn ? '⏰ Time'          : '⏰时间'
  const labelTable   = isEn ? '🪑 Table'         : '🪑 桌位'
  const labelParty   = isEn ? '👥 Group Size'    : '👥 人数'
  const labelAddress = isEn ? '📍 Address'       : '📍 地址'
  const partySizeStr = isEn ? `${partySize} ${partySize === 1 ? 'person' : 'people'}` : `${partySize} 人`
  // mapLinkText removed – now using standalone buttons below

  const depositBadge = depositAmount > 0
    ? (isEn
        ? `✅ Deposit paid: <strong>${formatGBP(depositAmount)}</strong>. Remaining balance due on arrival.`
        : `✅ 已支付定金 <strong>${formatGBP(depositAmount)}</strong>，余款到店结清`)
    : (isEn
        ? `✅ Booking confirmed — no deposit required. Pay in full on arrival.`
        : `✅ 预约已确认，无需预付定金，到店结清即可`)

  // 加入会员只在中文预约里发生（英文版不开放会员），所以这一句只有中文版
  const memberBadge = memberJoined && !isEn
    ? `<div style="background:#fdf1ee;border:1px solid #f3d6cd;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:14px;color:#8a4a35;line-height:1.6;">
        🎉 你已加入<strong>糖豆人会员</strong>：每次到店计时都累积进度，满 2 次得 £2 抵用券，满 5 次得 £5，满 10 次解锁 VIP 月卡。到店扫桌上的二维码，就能在自己的手机上查看进度。
      </div>`
    : ''

  const locationWarning = isEn
    ? `⚠️ Our studio is inside an office building and can be a little tricky to find on your first visit. Please read the Location Guide <strong>before you leave home</strong>!`
    : `⚠️ 本工作室位于写字楼内部，初次到访可能不易找到，请在<strong>出发前</strong>仔细阅读地点指引！`

  const locationBtnText = isEn ? '📍 View Location Guide' : '📍 查看详细地点指引'
  const mapBtnText      = isEn ? '🗺️ Open in Google Maps' : '🗺️ 在 Google Maps 中打开'

  const policyTitle  = isEn ? 'Cancellation Policy'  : '取消政策'
  const policyBody   = isEn
    ? `Cancellations made 12+ hours before your session are fully refunded.<br />
       Cancellations within 12 hours are non-refundable.<br />
       Refunds are processed within 5–10 business days.`
    : `距预约开始 12 小时以上取消，定金全额退还。<br />
       不足 12 小时取消，定金不予退还。<br />
       退款将在 5–10 个工作日内原路返回。`

  const cancelBtnText   = isEn ? 'Need to cancel? Click here' : '需要取消预约？点击此处'
  const cancelExpiry    = isEn
    ? 'This cancellation link expires in 15 days. After that, please contact the studio directly.'
    : '此取消链接将在 15 天后失效。超期请联系工作室。'

  const html = `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isEn ? 'Booking Confirmation' : '预约确认'}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #faf8f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 32px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #D97059 0%, #C4573A 100%); padding: 32px 32px 24px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 22px; margin: 0 0 6px; }
    .header p  { color: rgba(255,255,255,0.85); font-size: 14px; margin: 0; }
    .body { padding: 28px 32px; }
    .greeting { font-size: 16px; color: #3d2f2a; margin-bottom: 20px; }
    .detail-box { background: #fdf6f0; border: 1px solid #f0e0d0; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .detail-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; border-bottom: 1px solid #f5ede5; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #8a7060; }
    .detail-value { color: #3d2f2a; font-weight: 600; text-align: right; }
    .deposit-badge { background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; color: #2e7d32; text-align: center; }
    .policy-box { background: #fff8f0; border-left: 3px solid #D97059; padding: 14px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px; font-size: 13px; color: #6b4c3b; line-height: 1.6; }
    .cancel-btn { display: block; text-align: center; background: #f5f0eb; border: 1px solid #ddd0c8; border-radius: 10px; padding: 13px; color: #8a7060; font-size: 13px; text-decoration: none; margin-bottom: 24px; }
    .footer { padding: 20px 32px 28px; border-top: 1px solid #f0e8e0; font-size: 12px; color: #b09080; text-align: center; line-height: 1.8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${isEn ? '🎉 Booking Confirmed!' : '🎉 预约成功！'}</h1>
      <p>${studioName}</p>
    </div>
    <div class="body">
      <!-- 醒目地点指引横幅 -->
      <div style="background:#fff3cd;border:2px solid #f5a623;border-radius:12px;padding:18px 20px;margin-bottom:20px;text-align:center;">
        <p style="margin:0 0 12px;font-size:15px;color:#7a4f00;line-height:1.6;">${locationWarning}</p>
        <a href="${locationUrl}"
           style="display:block;background:#D97059;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 0;border-radius:8px;margin-bottom:10px;letter-spacing:0.3px;">
          ${locationBtnText}
        </a>
        <a href="${studioMapUrl}"
           style="display:block;background:#ffffff;color:#D97059;text-decoration:none;font-weight:600;font-size:14px;padding:10px 0;border-radius:8px;border:2px solid #D97059;">
          ${mapBtnText}
        </a>
      </div>

      <p class="greeting">${greeting}</p>

      <div class="detail-box">
        <div class="detail-row">
          <span class="detail-label">${labelDate}</span>
          <span class="detail-value">${bookingDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${labelTime}</span>
          <span class="detail-value">${startTime} – ${endTime}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${labelTable}</span>
          <span class="detail-value">${tableDisplay}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${labelParty}</span>
          <span class="detail-value">${partySizeStr}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${labelAddress}</span>
          <span class="detail-value">${studioAddress}</span>
        </div>
      </div>

      <div class="deposit-badge">${depositBadge}</div>

      ${memberBadge}

      <div class="policy-box">
        <strong>${policyTitle}</strong><br />
        ${policyBody}
      </div>

      <a href="${cancelUrl}" class="cancel-btn">${cancelBtnText}</a>

      <p style="font-size:12px;color:#b09080;text-align:center;margin:0;">
        ${cancelExpiry}
      </p>
    </div>
    <div class="footer">
      ${studioName}<br />
      ${studioAddress}<br />
      📧 ${studioEmail}
    </div>
  </div>
</body>
</html>
  `.trim()

  return { subject, html }
}
