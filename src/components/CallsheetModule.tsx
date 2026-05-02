import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Project, Scene, StripboardItem, ProductionRole } from '../types';
import { FileText, Download, Printer, MapPin, Clock, Users, Phone, Mail } from 'lucide-react';
import { OperationType, handleFirestoreError, cn, hasModuleAccess } from '../lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface CallsheetModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function CallsheetModule({ project, userRole }: CallsheetModuleProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [scheduledItems, setScheduledItems] = useState<StripboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, [project]);

  const fetchData = async () => {
    try {
      const sq = query(
        collection(db, 'scenes'), 
        where('projectId', '==', project.id)
      );
      const iq = query(
        collection(db, 'stripboard'), 
        where('projectId', '==', project.id)
      );
      
      const [scenesSnap, itemsSnap] = await Promise.all([getDocs(sq), getDocs(iq)]);
      
      setScenes(scenesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Scene)));
      setScheduledItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as StripboardItem))
        .sort((a, b) => a.shootDay - b.shootDay || a.order - b.order));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'callsheet', auth);
    } finally {
      setLoading(false);
    }
  };

  const groupedItems = scheduledItems.reduce((acc, item) => {
    if (!acc[item.shootDay]) acc[item.shootDay] = [];
    acc[item.shootDay].push(item);
    return acc;
  }, {} as Record<number, StripboardItem[]>);

  const shootDays = Object.keys(groupedItems).map(Number).sort((a, b) => a - b);
  const currentItems = groupedItems[selectedDay] || [];

  const handleExportPDF = async () => {
    if (!sheetRef.current) return;
    const canvas = await html2canvas(sheetRef.current, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`CallSheet_Day${selectedDay}_${project.name}.pdf`);
  };

  if (loading) return <div className="h-full flex items-center justify-center p-20 italic text-brand-gray-500 font-sans">Preparing production call sheets...</div>;

  return (
    <div className="flex flex-col h-full bg-brand-gray-100 overflow-hidden">
      <div className="h-auto md:h-16 border-b border-brand-gray-200 flex flex-col md:flex-row items-center justify-between p-4 md:px-8 bg-white shrink-0 gap-4">
        <div className="flex items-center space-x-4 w-full md:w-auto">
          <div className="text-xs md:text-sm text-brand-gray-500 whitespace-nowrap">Planning &rarr; Call Sheet</div>
          <div className="h-4 w-px bg-brand-gray-300"></div>
          <select 
            value={selectedDay}
            onChange={(e) => setSelectedDay(Number(e.target.value))}
            className="flex-1 md:flex-none text-xs md:text-sm font-bold text-brand-blue bg-blue-50 px-3 py-2 rounded border-none focus:ring-1 focus:ring-brand-blue"
          >
            {shootDays.map(day => (
              <option key={day} value={day}>Day {day.toString().padStart(2, '0')}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button onClick={() => window.print()} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-brand-gray-200 rounded text-[10px] font-bold hover:bg-brand-gray-50 transition-all uppercase">
            <Printer size={14} /> Print
          </button>
          <button onClick={handleExportPDF} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-brand-blue text-white rounded text-[10px] font-bold hover:bg-blue-700 transition-all shadow-sm uppercase">
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto p-4 md:p-12 flex items-start justify-center bg-brand-gray-100">
        {/* Call Sheet Document */}
        <div 
          ref={sheetRef}
          className="w-full max-w-[210mm] min-h-[297mm] bg-white shadow-2xl p-6 md:p-[20mm] flex flex-col font-sans text-brand-gray-900 border border-brand-gray-200 shrink-0 mx-auto"
          id="printable-call-sheet"
        >
          {/* Document Header */}
          <header className="border-b-4 border-brand-gray-900 pb-6 md:pb-8 flex flex-col md:flex-row justify-between items-start md:items-end mb-8 md:mb-10 gap-4">
            <div>
               <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter mb-2 italic">Call Sheet</h1>
               <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-brand-gray-400">Production Office: +880 1712-XXXXXX</p>
            </div>
            <div className="md:text-right">
               <h2 className="text-xl md:text-2xl font-bold tracking-tight">{project.name}</h2>
               <p className="text-[10px] font-bold text-brand-blue uppercase tracking-widest">DRISHYA PRODUCTION SUITE</p>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-12 mb-8 md:mb-10 border-b border-brand-gray-100 pb-8 md:pb-10">
             <section className="md:col-span-2 grid grid-cols-2 gap-4 md:gap-8">
                <div>
                   <label className="text-[9px] md:text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 md:mb-2 tracking-widest">Shoot Date</label>
                   <div className="text-sm md:text-lg font-bold">Friday, May 01, 2026</div>
                </div>
                <div>
                   <label className="text-[9px] md:text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 md:mb-2 tracking-widest">Shoot Day</label>
                   <div className="text-sm md:text-lg font-bold">{selectedDay} of {shootDays.length}</div>
                </div>
                <div className="col-span-2">
                   <label className="text-[9px] md:text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 md:mb-2 tracking-widest">Primary Location</label>
                   <div className="text-xs md:text-sm font-bold flex items-center gap-2">
                      <MapPin size={14} className="text-brand-blue shrink-0" />
                      124/A, Banani Road, Dhaka, Bangladesh
                   </div>
                   <div className="text-[9px] text-brand-gray-500 mt-1 italic">Nearest Hospital: Apollo Hospital Dhaka</div>
                </div>
             </section>
             <section className="bg-brand-gray-900 text-white p-6 rounded relative overflow-hidden flex flex-col justify-center">
                <div className="relative z-10">
                  <label className="text-[9px] md:text-[10px] uppercase font-bold text-white/50 block mb-1 md:mb-2 tracking-widest">Call Time</label>
                  <div className="text-3xl md:text-4xl font-black italic">07:00 AM</div>
                  <div className="mt-3 md:mt-4 flex items-center gap-2 text-[9px] md:text-[10px] font-bold text-white/70">
                    <Clock size={12} /> SUNRISE 05:22 | SUNSET 18:45
                  </div>
                </div>
             </section>
          </div>

          <section className="mb-8 md:mb-10 overflow-x-auto">
             <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest mb-4 flex items-center gap-2 pb-2 border-b-2 border-brand-gray-900 whitespace-nowrap">
               <FileText size={14} /> Schedule of Scenes
             </h3>
             <div className="min-w-[600px] md:min-w-0">
               <table className="w-full text-left border-collapse">
                  <thead>
                     <tr className="text-[9px] md:text-[10px] uppercase font-bold text-brand-gray-400 border-b border-brand-gray-100">
                        <th className="py-2">Sc #</th>
                        <th className="py-2">Type</th>
                        <th className="py-2">Location/Description</th>
                        <th className="py-2">Cast & Mood</th>
                        <th className="py-2">Props/Wardrobe</th>
                        <th className="py-2 text-right">Time</th>
                     </tr>
                  </thead>
                  <tbody className="text-[11px] md:text-xs font-medium">
                     {currentItems.map(item => {
                       const scene = scenes.find(s => s.id === item.sceneId);
                       if (!scene) return null;
                       return (
                         <tr key={item.id} className="border-b border-brand-gray-50 group">
                            <td className="py-3 md:py-4 font-bold text-sm text-brand-blue">{scene.number}</td>
                            <td className="py-3 md:py-4 text-[9px] md:text-[10px] font-bold text-brand-gray-500 uppercase">{scene.intExt} / {scene.dayNight[0]}</td>
                            <td className="py-3 md:py-4">
                              <div className="font-bold text-[11px] md:text-xs">{scene.location}</div>
                              {scene.directorNotes && <div className="text-[9px] text-brand-gray-400 mt-0.5 line-clamp-1 italic">"{scene.directorNotes}"</div>}
                            </td>
                            <td className="py-3 md:py-4">
                               <div className="flex flex-wrap gap-1 mb-1">
                                  {(scene.cast && scene.cast.length > 0) ? scene.cast.map((c, i) => (
                                    <span key={i} className="bg-brand-gray-100 px-1 py-0.5 rounded text-[8px] font-bold uppercase">{c}</span>
                                  )) : <span className="text-gray-300">Generic</span>}
                               </div>
                            </td>
                            <td className="py-3 md:py-4">
                               <div className="flex flex-col gap-0.5">
                                 {scene.props?.length ? <div className="text-[8px] text-brand-gray-500 uppercase"><span className="font-bold">P:</span> {scene.props.join(', ')}</div> : null}
                                 {scene.wardrobe?.length ? <div className="text-[8px] text-brand-gray-500 uppercase"><span className="font-bold">W:</span> {scene.wardrobe.join(', ')}</div> : null}
                               </div>
                            </td>
                            <td className="py-3 md:py-4 text-right font-mono font-bold text-brand-gray-500">08:00 A</td>
                         </tr>
                       );
                     })}
                  </tbody>
               </table>
             </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mb-8 md:mb-10">
             <div>
                <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest mb-4 flex items-center gap-2 pb-2 border-b-2 border-brand-gray-900 leading-none">
                  <Users size={14} /> Cast Requirements
                </h3>
                <div className="space-y-2">
                   <div className="flex justify-between items-center bg-brand-gray-50 p-2 rounded">
                      <div className="text-[11px] md:text-xs font-bold font-serif italic text-brand-gray-600">Amal (Lead)</div>
                      <div className="text-[9px] md:text-[10px] font-bold bg-brand-gray-900 text-white px-2 py-0.5 rounded uppercase">Call: 07:30 A</div>
                   </div>
                   <div className="flex justify-between items-center bg-brand-gray-50 p-2 rounded">
                      <div className="text-[11px] md:text-xs font-bold font-serif italic text-brand-gray-600">Officer Bashir</div>
                      <div className="text-[9px] md:text-[10px] font-bold bg-brand-gray-900 text-white px-2 py-0.5 rounded uppercase">Call: 09:00 A</div>
                   </div>
                </div>
             </div>
             <div>
                <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest mb-4 flex items-center gap-2 pb-2 border-b-2 border-brand-gray-900 leading-none">
                  <Printer size={14} /> Production Contacts
                </h3>
                <div className="space-y-3 text-[9px] md:text-[10px] font-bold text-brand-gray-500 uppercase tracking-tighter">
                   <div className="flex items-center justify-between border-b border-brand-gray-100 pb-1">
                      <span className="text-brand-gray-900 truncate pr-4">Director: Asif Ahmed</span>
                      <div className="flex gap-3 shrink-0">
                        <Phone size={12} className="text-brand-blue" />
                        <Mail size={12} className="text-brand-blue" />
                      </div>
                   </div>
                   <div className="flex items-center justify-between border-b border-brand-gray-100 pb-1">
                      <span className="text-brand-gray-900 truncate pr-4">Prod Mgr: Rakin Hasan</span>
                      <div className="flex gap-3 shrink-0">
                        <Phone size={12} className="text-brand-blue" />
                        <Mail size={12} className="text-brand-blue" />
                      </div>
                   </div>
                </div>
             </div>
          </section>
          
          {/* Footer Notes */}
          <footer className="mt-auto pt-6 md:pt-8 border-t-4 border-brand-gray-900">
             <div className="bg-brand-gray-50 p-4 rounded border border-brand-gray-100">
                <label className="text-[9px] md:text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 md:mb-2 tracking-widest">Director's Notes</label>
                <p className="text-[11px] md:text-xs italic text-brand-gray-600 leading-relaxed">
                   "Keep the set quiet during Scene {currentItems[0]?.sceneId ? scenes.find(s => s.id === currentItems[0].sceneId)?.number : ''} emotional beats. Gritty Dhaka aesthetic."
                </p>
             </div>
             <div className="flex justify-between items-center mt-4 text-[7px] md:text-[8px] font-bold uppercase tracking-widest text-brand-gray-400">
                <span>Call Sheet v1.4</span>
                <span className="hidden sm:inline">Generated by Drishya</span>
                <span>Day {selectedDay}</span>
             </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
