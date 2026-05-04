import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, deleteDoc } from 'firebase/firestore';
import { Project, Scene, StripboardItem, ProductionRole } from '../types';
import { Plus, GripVertical, MapPin, Sun, Moon, Calendar, Trash2, AlertCircle, Clock, Zap, Users, CheckCircle2, Circle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { OperationType, handleFirestoreError, cn, hasFieldAccess, hasPermission, groupScenes } from '../lib/utils';

interface StripboardModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function StripboardModule({ project, userRole }: StripboardModuleProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [scheduledItems, setScheduledItems] = useState<StripboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupingType, setGroupingType] = useState<'LOCATION' | 'CAST'>('LOCATION');

  const canEdit = hasPermission(userRole, 'edit_schedule');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
      
      const scenesData = scenesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Scene));
      const itemsData = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as StripboardItem))
        .sort((a, b) => a.shootDay - b.shootDay || a.order - b.order);
      
      setScenes(scenesData);
      setScheduledItems(itemsData);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'stripboard', auth);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToSchedule = async (sceneId: string) => {
    const lastItem = scheduledItems[scheduledItems.length - 1];
    const shootDay = lastItem ? lastItem.shootDay : 1;
    const order = lastItem ? lastItem.order + 1 : 0;

    const newItem: Omit<StripboardItem, 'id'> = {
      projectId: project.id,
      ownerId: project.ownerId,
      sceneId,
      shootDay,
      order
    };

    try {
      const docRef = doc(collection(db, 'stripboard'));
      const batch = writeBatch(db);
      batch.set(docRef, newItem);
      await batch.commit();
      setScheduledItems([...scheduledItems, { id: docRef.id, ...newItem }]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'stripboard', auth);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = scheduledItems.findIndex(i => i.id === active.id.toString());
    const newIndex = scheduledItems.findIndex(i => i.id === over.id.toString());
    
    const newItems = arrayMove(scheduledItems, oldIndex, newIndex);
    setScheduledItems(newItems);

    // Persist reorder
    setSaving(true);
    try {
      const batch = writeBatch(db);
      newItems.forEach((item: any, idx) => {
        const ref = doc(db, 'stripboard', item.id);
        batch.update(ref, { order: idx });
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'stripboard', auth);
    } finally {
      setSaving(false);
    }
  };

  const addShootDay = () => {
    const lastDay = scheduledItems.length > 0 ? Math.max(...scheduledItems.map(i => i.shootDay)) : 0;
    // Just a placeholder, days are dynamically calculated or assigned
  };

  const groupedItems = scheduledItems.reduce((acc, item) => {
    if (!acc[item.shootDay]) acc[item.shootDay] = [];
    acc[item.shootDay].push(item);
    return acc;
  }, {} as Record<number, StripboardItem[]>);

  const unscheduledScenes = scenes.filter(s => !scheduledItems.some(i => i.sceneId === s.id));

  // Suggestion logic
  const getSuggestions = () => {
    if (groupingType === 'LOCATION') {
      const groups = groupScenes(unscheduledScenes);
      // Map it back to the [string, Scene[]][] format expected by the UI
      return groups
        .filter(g => g.scenes.length > 1)
        .map(g => [`${g.location} (${g.time})`, g.scenes] as [string, Scene[]]);
    } else {
      const groups: Record<string, Scene[]> = {};
      unscheduledScenes.forEach(s => {
        s.cast?.forEach(character => {
          if (!groups[character]) groups[character] = [];
          groups[character].push(s);
        });
      });
      return Object.entries(groups).filter(([_, items]) => items.length > 1);
    }
  };

  const suggestions = getSuggestions();

  if (loading) return <div className="h-full flex items-center justify-center p-20 italic text-brand-gray-500 font-sans">Compiling shoot strips...</div>;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header Bar */}
      <div className="h-16 border-b border-brand-gray-200 flex items-center justify-between px-8 bg-white">
        <div className="flex items-center space-x-4">
          <div className="text-sm text-brand-gray-500">Scheduling &rarr; Stripboard</div>
          <div className="h-4 w-px bg-brand-gray-300"></div>
          <div className="text-sm font-semibold">Production Stripboard</div>
        </div>
        <div className="flex items-center gap-4">
          {saving && <span className="text-[10px] font-bold text-brand-blue animate-pulse">SAVING PRODUCTION STATE...</span>}
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Unscheduled Scenes Section - Only for Director/AD */}
        {canEdit && (
          <div className="hidden md:flex w-80 border-r border-brand-gray-200 bg-brand-gray-50 flex-col shrink-0">
            <div className="p-4 border-b border-brand-gray-200 bg-white flex justify-between items-center shrink-0">
              <h3 className="text-xs font-bold uppercase tracking-widest text-brand-gray-500">Unscheduled</h3>
              <div className="flex bg-brand-gray-100 p-1 rounded gap-1">
                 <button 
                   onClick={() => setGroupingType('LOCATION')}
                   className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded", groupingType === 'LOCATION' ? "bg-white shadow-sm text-brand-blue" : "text-brand-gray-500")}
                 >
                   Loc
                 </button>
                 <button 
                   onClick={() => setGroupingType('CAST')}
                   className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded", groupingType === 'CAST' ? "bg-white shadow-sm text-brand-blue" : "text-brand-gray-500")}
                 >
                   Cast
                 </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <UnscheduledList 
                suggestions={suggestions} 
                unscheduledScenes={unscheduledScenes} 
                handleAddToSchedule={handleAddToSchedule} 
                groupingType={groupingType} 
              />
            </div>
          </div>
        )}

        {/* Primary Content Area */}
        <div className="flex-1 overflow-y-auto bg-brand-bg md:p-10 pb-24 md:pb-10">
          <div className="max-w-4xl mx-auto p-4 md:p-0 space-y-6 md:space-y-12">
            
            {/* Mobile-Only Unscheduled Header/Section - Only for Director/AD */}
            {canEdit && (
              <div className="md:hidden space-y-4">
                 <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-gray-400">Add to Sequence</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setGroupingType('LOCATION')} className={cn("text-[9px] font-bold uppercase px-2 py-1 rounded", groupingType === 'LOCATION' ? "bg-brand-blue text-white" : "bg-brand-gray-100 text-brand-gray-500")}>Loc</button>
                      <button onClick={() => setGroupingType('CAST')} className={cn("text-[9px] font-bold uppercase px-2 py-1 rounded", groupingType === 'CAST' ? "bg-brand-blue text-white" : "bg-brand-gray-100 text-brand-gray-500")}>Cast</button>
                    </div>
                 </div>
                 <div className="bg-brand-gray-50 border border-brand-gray-200 rounded-xl p-4 max-h-60 overflow-y-auto shadow-inner">
                    <UnscheduledList 
                      suggestions={suggestions} 
                      unscheduledScenes={unscheduledScenes} 
                      handleAddToSchedule={handleAddToSchedule} 
                      groupingType={groupingType}
                      isMobile={true}
                    />
                 </div>
              </div>
            )}

            <header className="flex flex-col sm:flex-row justify-between items-start md:items-end gap-4 border-b border-brand-gray-100 pb-6 md:pb-0 md:border-none">
              <div>
                <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-brand-gray-900 italic leading-tight uppercase">Shoot Sequence</h2>
                <p className="text-[10px] uppercase tracking-widest font-bold text-brand-gray-500 mt-1">Production Stripboard</p>
              </div>
              <div className="flex md:flex-col items-center md:items-end gap-2 md:gap-0">
                 <div className="text-[10px] uppercase font-bold text-brand-gray-400 whitespace-nowrap">Indexed: {scheduledItems.length}</div>
                 <div className="text-sm md:text-xl font-bold text-brand-gray-900 bg-brand-gray-100 md:bg-transparent px-3 py-1 md:p-0 rounded-full">Day 01 Complete</div>
              </div>
            </header>

            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-6">
                {scheduledItems.length === 0 ? (
                  <div className="h-48 md:h-64 border-2 border-dashed border-brand-gray-200 rounded-xl flex flex-col items-center justify-center text-brand-gray-400 italic p-6">
                    <Calendar size={32} className="mb-4 opacity-10" />
                    <p className="text-sm">No scenes scheduled. Add from above.</p>
                  </div>
                ) : (
                  <SortableContext 
                    items={scheduledItems.map(i => i.id as string)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1">
                      {scheduledItems.map((item, idx) => {
                        const scene = scenes.find(s => s.id === item.sceneId);
                        if (!scene) return null;
                        return (
                          <SortableStrip 
                            key={item.id} 
                            id={item.id as string} 
                            scene={scene} 
                            isFirst={idx === 0}
                            onRemove={async () => {
                              try {
                                await deleteDoc(doc(db, 'stripboard', item.id));
                                setScheduledItems(scheduledItems.filter(i => i.id !== item.id));
                              } catch (err) {
                                handleFirestoreError(err, OperationType.DELETE, 'stripboard', auth);
                              }
                            }}
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                )}
              </div>
            </DndContext>

            {/* Constraint Legend stub - Simplified for mobile */}
            <div className="pt-8 md:pt-10 border-t border-brand-gray-200">
               <div className="bg-white p-4 md:p-6 border border-brand-gray-200 rounded shadow-sm">
                  <h4 className="text-[10px] uppercase font-bold text-brand-gray-400 mb-4 tracking-widest flex items-center gap-2">
                    <AlertCircle size={14} className="text-brand-blue" /> Production Logistics
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                     <div className="flex items-center justify-between p-3 bg-brand-gray-50 rounded">
                        <span className="text-brand-gray-500">Shoot Day Cap</span>
                        <span className="font-bold">12 Hours</span>
                     </div>
                     <div className="flex items-center justify-between p-3 bg-brand-gray-50 rounded opacity-50">
                        <span className="text-brand-gray-500">Cast Overlap Limit</span>
                        <span className="font-bold">Priority Only</span>
                     </div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UnscheduledList({ suggestions, unscheduledScenes, handleAddToSchedule, groupingType, isMobile = false }: { 
  suggestions: [string, Scene[]][], 
  unscheduledScenes: Scene[], 
  handleAddToSchedule: (id: string) => void,
  groupingType: string,
  isMobile?: boolean
}) {
  return (
    <div className="space-y-6">
      {suggestions.length > 0 && (
         <section className="space-y-3">
            <h4 className="text-[9px] font-bold text-brand-blue flex items-center gap-1 uppercase tracking-widest">
              <Zap size={10} /> Smart Groups
            </h4>
            {suggestions.map(([key, items]) => (
              <div key={key} className={cn("bg-blue-50 border border-blue-100 p-3 rounded-lg space-y-2", isMobile && "bg-white")}>
                 <div className="text-[10px] font-bold text-brand-blue truncate uppercase">{key}</div>
                 <div className="space-y-1">
                    {items.map(s => (
                      <div key={s.id} className="flex items-center justify-between text-[10px] font-medium text-brand-gray-600 bg-white/50 px-3 py-2 rounded-md border border-blue-200/50">
                         <span className="truncate pr-2">Sc {s.number}: {s.location}</span>
                         <button 
                           onClick={() => handleAddToSchedule(s.id)} 
                           className="bg-brand-blue text-white px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-transform active:scale-95"
                         >
                           Add
                         </button>
                      </div>
                    ))}
                 </div>
              </div>
            ))}
         </section>
      )}

      <section className={cn("space-y-2", !isMobile && "space-y-3")}>
        <h4 className="text-[9px] font-bold text-brand-gray-400 uppercase tracking-widest">Scenes ({unscheduledScenes.length})</h4>
        {unscheduledScenes.map(scene => (
          <div 
            key={scene.id} 
            className="bg-white border border-brand-gray-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-all flex justify-between items-center gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold text-brand-gray-400 mb-1">SCENE {scene.number}</div>
              <div className="text-xs font-bold text-brand-gray-900 truncate uppercase tracking-tight">{scene.location}</div>
            </div>
            <button 
              onClick={() => handleAddToSchedule(scene.id)}
              className="p-3 text-brand-blue bg-blue-50 hover:bg-brand-blue hover:text-white transition-colors rounded-xl border border-blue-100 shrink-0 shadow-sm active:scale-90"
            >
              <Plus size={18} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function SortableStrip({ id, scene, isFirst, onRemove }: { id: string, scene: Scene, isFirst: boolean, onRemove: () => void | Promise<void>, key?: any }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.6 : 1,
  };

  const statusIcons = {
    'completed': <CheckCircle2 size={16} className="text-green-500" />,
    'in-progress': <Circle size={16} className="text-brand-blue fill-brand-blue/20" />,
    'not-started': <Circle size={16} className="text-brand-gray-300" />
  };

  const currentStatus = scene.status || 'not-started';

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "group relative flex flex-col md:flex-row bg-white border border-brand-gray-200 hover:border-brand-blue transition-all overflow-hidden shadow-sm hover:shadow-md rounded-xl mb-3 md:mb-1",
        scene.dayNight === 'NIGHT' ? "border-l-[6px] border-l-brand-gray-900" : "border-l-[6px] border-l-orange-400",
        currentStatus === 'completed' && "opacity-60 grayscale-[0.5]"
      )}
    >
      {/* Drag Handle - Full Height on Desktop, Top Handle on Mobile */}
      <div 
        {...attributes} 
        {...listeners}
        className="hidden md:flex px-4 items-center border-r border-brand-gray-100 text-brand-gray-300 hover:text-brand-blue cursor-grab active:cursor-grabbing transition-colors"
      >
        <GripVertical size={18} />
      </div>

      <div className="flex flex-col md:flex-row flex-1 p-4 md:p-0">
        {/* Mobile Header / Desktop Scene Column */}
        <div className="flex justify-between items-center md:flex-col md:justify-center md:w-20 md:border-r border-brand-gray-100 md:px-0 mb-3 md:mb-0">
           <div className="flex flex-col items-start md:items-center">
             <span className="text-[10px] md:text-[9px] font-bold text-brand-gray-400 uppercase tracking-widest">Sc {scene.number}</span>
             <span className="hidden md:block text-lg font-black text-brand-gray-900">{scene.number}</span>
             <div className="hidden md:block mt-1">{statusIcons[currentStatus]}</div>
           </div>
           
           <div className="flex items-center gap-2 md:hidden">
              {statusIcons[currentStatus]}
              <span className="text-[10px] font-black text-brand-gray-400 uppercase tracking-widest bg-brand-gray-50 px-2 py-1 rounded border border-brand-gray-200">
                {scene.intExt} / {scene.dayNight[0]}
              </span>
              <button 
                {...attributes} 
                {...listeners}
                className="p-2 text-brand-gray-300 active:text-brand-blue"
              >
                <GripVertical size={20} />
              </button>
           </div>
        </div>

        {/* Info Area - Large Location & Metadata */}
        <div className="flex-1 md:px-6 md:py-4 flex flex-col justify-center">
          <div className="hidden md:flex items-center gap-3 text-[10px] font-extrabold text-brand-gray-400 uppercase tracking-widest mb-1">
            <span>{scene.intExt} / {scene.dayNight}</span>
            {scene.priority && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[8px] tracking-tighter",
                scene.priority === 'MUST' ? "bg-red-50 text-red-500 border border-red-100" : "bg-brand-gray-100 text-brand-gray-500"
              )}>
                {scene.priority}
              </span>
            )}
          </div>
          
          <h4 className="text-lg md:text-sm font-bold text-brand-gray-900 leading-tight flex items-center gap-2 mb-2 md:mb-0">
            <MapPin size={16} className="text-brand-gray-300 md:hidden shrink-0" />
            {scene.location}
          </h4>

          {/* Metadata Row - Visible on Mobile, Inline on Desktop */}
          <div className="flex flex-wrap items-center gap-4 mt-2 md:mt-2">
            <div className="flex items-center gap-1.5 text-[11px] md:text-[10px] font-bold text-brand-gray-500 uppercase tracking-tight">
              <Clock size={14} className="text-brand-gray-400 md:w-3 md:h-3" />
              <span>{scene.estimatedDuration || 120}m</span>
            </div>
            
            {scene.cast && scene.cast.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] md:text-[10px] font-bold text-brand-gray-500 uppercase tracking-tight">
                <Users size={14} className="text-brand-gray-400 md:w-3 md:h-3" />
                <span className="max-w-[120px] md:max-w-none truncate">{scene.cast.join(', ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions / Time on Desktop */}
        <div className="flex items-center justify-between md:justify-end md:w-48 md:border-l border-brand-gray-100 mt-4 md:mt-0 pt-3 md:pt-0 border-t md:border-t-0 border-brand-gray-50">
           <div className="flex items-center gap-2 md:hidden">
             {scene.priority === 'MUST' && (
               <span className="bg-red-50 text-red-600 text-[10px] font-black px-2 py-1 rounded border border-red-100 flex items-center gap-1">
                 <AlertCircle size={12} /> MUST
               </span>
             )}
           </div>
           
           <div className="flex items-center gap-1">
              <button 
                onClick={onRemove}
                className="p-3 md:p-2 text-brand-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                aria-label="Remove scene from stripboard"
              >
                <Trash2 size={20} className="md:w-4 md:h-4" />
              </button>
           </div>
        </div>
      </div>
    </div>
  );
}
