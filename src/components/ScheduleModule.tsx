import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Project, Scene, StripboardItem, SceneStatus, ProductionRole } from '../types';
import { Calendar, Users, MapPin, Clock, ChevronDown, ChevronUp, CheckCircle2, Circle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OperationType, handleFirestoreError, cn, hasModuleAccess } from '../lib/utils';

interface ScheduleModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function ScheduleModule({ project, userRole }: ScheduleModuleProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [scheduledItems, setScheduledItems] = useState<StripboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDays, setExpandedDays] = useState<number[]>([1]);

  const getStatusIcon = (status?: SceneStatus | string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={12} className="text-green-500" />;
      case 'in-progress': return <Circle size={12} className="text-brand-blue fill-brand-blue/20" />;
      default: return <Circle size={12} className="text-brand-gray-300" />;
    }
  };

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
      handleFirestoreError(err, OperationType.LIST, 'schedule', auth);
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

  const toggleDay = (day: number) => {
    setExpandedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  if (loading) return <div className="h-full flex items-center justify-center p-20 italic text-brand-gray-500 font-sans">Generating production schedule...</div>;

  return (
    <div className="flex flex-col h-full bg-brand-bg">
      <div className="h-16 border-b border-brand-gray-200 flex items-center justify-between px-8 bg-white">
        <div className="flex items-center space-x-4">
          <div className="text-sm text-brand-gray-500">Planning &rarr; Schedule</div>
          <div className="h-4 w-px bg-brand-gray-300"></div>
          <div className="text-sm font-semibold">Master Shooting Schedule</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-10">
        <div className="max-w-4xl mx-auto space-y-8">
          <header className="mb-12">
            <h1 className="text-5xl font-bold tracking-tight text-brand-gray-900">Shooting Schedule</h1>
            <p className="text-[10px] uppercase tracking-widest font-bold text-brand-gray-500 mt-4 italic border-l-4 border-brand-blue pl-4">
              Production: {project.name} / Total Days: {shootDays.length}
            </p>
          </header>

          {shootDays.length === 0 ? (
            <div className="bg-white border border-brand-gray-200 rounded-lg p-20 text-center text-brand-gray-400 italic shadow-sm">
               No scenes have been scheduled in the Stripboard yet.
            </div>
          ) : (
            <div className="space-y-6">
              {shootDays.map(day => (
                <div key={day} className="bg-white border border-brand-gray-200 rounded shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleDay(day)}
                    className="w-full flex items-center justify-between p-6 hover:bg-brand-gray-50 transition-colors border-l-8 border-l-brand-blue"
                  >
                    <div className="flex items-center gap-8">
                      <div className="text-2xl font-bold text-brand-gray-900 italic">Day {day.toString().padStart(2, '0')}</div>
                      <div className="flex items-center gap-4 text-xs font-bold text-brand-gray-500 uppercase tracking-widest">
                        <span>{groupedItems[day].length} Scenes</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-brand-gray-200" />
                        <span>Est. 12 Hours</span>
                      </div>
                    </div>
                    {expandedDays.includes(day) ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>

                  <AnimatePresence>
                    {expandedDays.includes(day) && (
                      <motion.div 
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden bg-brand-gray-50/30"
                      >
                        <div className="p-6 border-t border-brand-gray-100 space-y-px">
                           <div className="grid grid-cols-12 px-4 py-2 text-[10px] uppercase font-bold text-brand-gray-400 tracking-widest">
                              <div className="col-span-1">Sc.</div>
                              <div className="col-span-1">T.</div>
                              <div className="col-span-4">Location</div>
                              <div className="col-span-4">Cast Presence</div>
                              <div className="col-span-2 text-right">Time</div>
                           </div>
                           {groupedItems[day].map(item => {
                             const scene = scenes.find(s => s.id === item.sceneId);
                             if (!scene) return null;
                             return (
                               <div key={item.id} className={cn("grid grid-cols-12 items-center px-4 py-6 bg-white border border-brand-gray-100 text-xs hover:shadow-md transition-shadow", scene.status === 'completed' && "opacity-60")}>
                                  <div className="col-span-1 font-bold text-brand-blue text-sm flex items-center gap-2">
                                    {getStatusIcon(scene.status)}
                                    {scene.number}
                                  </div>
                                  <div className="col-span-1 text-[10px] font-bold text-brand-gray-400">{(scene.intExt as string)[0]}</div>
                                  <div className="col-span-4 font-bold text-brand-gray-900 flex items-center gap-2">
                                    <MapPin size={12} className="text-brand-gray-300" />
                                    {scene.location}
                                  </div>
                                  <div className="col-span-4 flex items-center gap-3">
                                     <Users size={12} className="text-brand-gray-300" />
                                     <div className="flex flex-wrap gap-1">
                                        {(scene.cast && scene.cast.length > 0) ? scene.cast.map((c, i) => (
                                          <span key={i} className="bg-brand-gray-100 px-1.5 py-0.5 rounded text-[10px] font-bold text-brand-gray-600 uppercase italic">{c}</span>
                                        )) : <span className="text-brand-gray-300">Generic PPD</span>}
                                     </div>
                                  </div>
                                  <div className="col-span-2 text-right text-brand-gray-500 font-mono flex items-center justify-end gap-1">
                                     <Clock size={10} />
                                     <span>08:00 AM</span>
                                  </div>
                               </div>
                             );
                           })}
                        </div>
                        <div className="p-6 bg-white border-t border-brand-gray-100 flex justify-between items-center">
                           <div className="flex gap-4">
                              <div className="text-[10px] font-bold text-brand-gray-400 uppercase tracking-widest">Base Camp</div>
                              <div className="text-xs font-bold text-brand-gray-900">Standard Production HQ</div>
                           </div>
                           <button className="text-[10px] font-bold text-brand-blue uppercase tracking-widest hover:underline">
                             Generate Call Sheet for this day &rarr;
                           </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
