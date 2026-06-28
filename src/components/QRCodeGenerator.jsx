import { QRCodeSVG } from 'qrcode.react';

export default function QRCodeGenerator({ value, size = 180, title }) {
    return (
        <div className="flex flex-col items-center justify-center p-6 bg-slate-900/90 border border-slate-700/50 rounded-2xl shadow-xl backdrop-blur-md">
            {title && (
                <h4 className="text-sm font-semibold text-slate-300 mb-4 text-center tracking-wide uppercase">
                    {title}
                </h4>
            )}
            <div className="p-4 bg-white rounded-xl shadow-inner border border-slate-200">
                <QRCodeSVG 
                    value={value} 
                    size={size}
                    bgColor="#FFFFFF"
                    fgColor="#0f172a"
                    level="Q"
                    includeMargin={false}
                />
            </div>
            <p className="mt-4 text-xs text-slate-400 text-center leading-relaxed max-w-[220px]">
                Bu QR kodu akıllı TV, tablet veya başka bir ekranın kamerasıyla taratarak bu odayı yansıtabilirsiniz.
            </p>
        </div>
    );
}
