import { Mail, Phone, Send } from 'lucide-react';

const SUPPORT_EMAIL = 'lorasafewatch@gmail.com';
const SUPPORT_PHONE = '09260557361';
const SUPPORT_PHONE_LINK = 'tel:+639260557361';

export default function HelpSupport() {
  return <div className="admin-page admin-help">
    <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 max-w-2xl">
      <h3 className="text-2xl font-bold text-slate-800 mb-2">Contact Support</h3>
      <p className="text-sm text-slate-400 font-medium mb-10">Need more help? Contact the SafeWatch support team.</p>
      <div className="space-y-8 mb-10">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 shrink-0 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center"><Mail className="w-6 h-6" aria-hidden="true"/></div>
          <div className="min-w-0">
            <p className="font-bold text-slate-800">Email Support</p>
            <a className="text-emerald-700 font-bold underline break-all" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 shrink-0 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center"><Phone className="w-6 h-6" aria-hidden="true"/></div>
          <div className="min-w-0">
            <p className="font-bold text-slate-800">Phone Support</p>
            <a className="text-emerald-700 font-bold underline" href={SUPPORT_PHONE_LINK}>{SUPPORT_PHONE}</a>
          </div>
        </div>
      </div>
      <a href={`mailto:${SUPPORT_EMAIL}`} className="w-full py-4 rounded-2xl border-2 border-emerald-500 text-emerald-700 font-bold text-sm hover:bg-emerald-50 transition-all flex items-center justify-center gap-2"><Send className="w-4 h-4" aria-hidden="true"/>Send us a Message</a>
    </div>
  </div>;
}
