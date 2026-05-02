import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, addDoc, orderBy, limit, deleteDoc } from 'firebase/firestore';
import { Project, Scene, ScriptVersion, ProductionRole } from '../types';
import { Upload, FileText, AlertCircle, Loader2, Search, MapPin, Sun, Moon, Info, Plus, FileUp, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseScript } from '../lib/scriptParser';
import { OperationType, handleFirestoreError, cn, hasPermission } from '../lib/utils';

interface ScriptModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function ScriptModule({ project, userRole }: ScriptModuleProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [latestVersion, setLatestVersion] = useState<ScriptVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [debugSteps, setDebugSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, [project]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // 1. Fetch latest script version
      const vq = query(
        collection(db, 'scriptVersions'),
        where('projectId', '==', project.id),
        orderBy('version', 'desc'),
        limit(1)
      );
      const vSnap = await getDocs(vq);
      const version = vSnap.docs.length > 0 ? { id: vSnap.docs[0].id, ...vSnap.docs[0].data() } as ScriptVersion : null;
      setLatestVersion(version);

      // 2. Fetch scenes
      const sq = query(
        collection(db, 'scenes'),
        where('projectId', '==', project.id)
      );
      const sSnap = await getDocs(sq);
      const sData = sSnap.docs.map(d => ({ id: d.id, ...d.data() } as Scene));
      const sorted = sData.sort((a, b) => a.order - b.order);
      setScenes(sorted);
      if (sorted.length > 0) setSelectedScene(sorted[0]);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'script_init', auth);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!hasPermission(userRole, "upload_script")) {
      setError("Missing or insufficient permissions: You do not have permission to upload scripts.");
      return;
    }

    const allowedExtensions = ['pdf', 'fdx', 'fountain', 'txt', 'docx', 'rtf'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      setError("Supported formats: .pdf, .fdx, .fountain, .txt, .docx, .rtf");
      return;
    }

    setUploading(true);
    setError(null);
    setDebugSteps(["File detected and validated."]);

    try {
      console.log("[Pipeline] Starting parsing...");
      setDebugSteps(prev => [...prev, "Parsing screenplay structure..."]);
      // 1. Parse script immediately to ensure validity
      const parsedScenes = await parseScript(file);
      
      if (parsedScenes.length === 0) {
        console.warn("[Pipeline] Parsing completed but no scenes were found.");
        setDebugSteps(prev => [...prev, "Parsing completed but empty."]);
        throw new Error("Script uploaded but parsing failed: No scenes detected. Please check formatting.");
      }

      console.log(`[Pipeline] Scenes extracted: ${parsedScenes.length}`);
      setDebugSteps(prev => [...prev, `Extracted ${parsedScenes.length} scenes.`]);

      // 2. Storage/DB Update
      setDebugSteps(prev => [...prev, "Updating production database..."]);
      const nextVersion = latestVersion ? latestVersion.version + 1 : 1;
      const versionData: Omit<ScriptVersion, 'id'> = {
        projectId: project.id,
        ownerId: project.ownerId,
        fileName: file.name,
        uploadDate: new Date().toISOString(),
        version: nextVersion,
        status: 'processing',
        sceneCount: parsedScenes.length
      };

      const vRef = await addDoc(collection(db, 'scriptVersions'), versionData);
      setLatestVersion({ id: vRef.id, ...versionData });

      // 3. Clear existing scenes for this project (Atomic replacement)
      const batch = writeBatch(db);
      const existingScenesQuery = query(
        collection(db, 'scenes'), 
        where('projectId', '==', project.id),
        where('ownerId', '==', project.ownerId)
      );
      const existingScenesSnap = await getDocs(existingScenesQuery);
      existingScenesSnap.docs.forEach(d => batch.delete(d.ref));

      // 4. Add new scenes
      const newScenes: Scene[] = [];
      parsedScenes.forEach((ps, idx) => {
        const sRef = doc(collection(db, 'scenes'));
        const sData: Omit<Scene, 'id'> = {
          projectId: project.id,
          ownerId: project.ownerId,
          number: ps.number,
          intExt: ps.intExt,
          location: ps.location,
          dayNight: ps.dayNight,
          synopsis: ps.content,
          order: idx,
          cast: [],
          props: [],
          wardrobe: [],
          directorNotes: '',
          emotionalIntensity: 5,
        };
        batch.set(sRef, sData);
        newScenes.push({ id: sRef.id, ...sData });
      });

      // 5. Update version status to ready
      batch.update(vRef, { status: 'ready' });

      await batch.commit();
      console.log("[Pipeline] Database updated successfully.");
      setDebugSteps(prev => [...prev, "Import complete!"]);

      setScenes(newScenes);
      setSelectedScene(newScenes[0]);
      setLatestVersion(prev => prev ? { ...prev, status: 'ready' } : null);
    } catch (err: any) {
      console.error("[Pipeline] Failure:", err);
      setError(err.message || "Script uploaded but parsing failed. Ensure it follows standard screenplay format.");
      setDebugSteps(prev => [...prev, "Critical failure during import."]);
    } finally {
      setUploading(false);
    }
  };

  const filteredScenes = scenes.filter(s => 
    s.location.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.number.includes(searchQuery)
  );

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-20 bg-brand-bg">
        <Loader2 className="animate-spin text-brand-blue mb-4" size={32} />
        <p className="italic text-brand-gray-500 font-sans">Compiling project history and scenes...</p>
      </div>
    );
  }

  const canUpload = hasPermission(userRole, 'upload_script');
  const hasScript = scenes.length > 0 || latestVersion;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Script Header Bar */}
      <div className="h-16 border-b border-brand-gray-200 flex items-center justify-between px-8 bg-white overflow-hidden shrink-0">
        <div className="flex items-center space-x-4">
          <div className="text-sm text-brand-gray-500">Script &rarr; Scenes</div>
          <div className="h-4 w-px bg-brand-gray-300"></div>
          {latestVersion ? (
            <div className="flex items-center gap-2">
              <FileUp size={14} className="text-brand-blue" />
              <div className="text-sm font-semibold truncate max-w-[200px]">{latestVersion.fileName}</div>
              <span className="bg-brand-gray-100 px-2 py-0.5 rounded text-[8px] font-bold text-brand-gray-500 uppercase">v{latestVersion.version.toFixed(1)}</span>
            </div>
          ) : (
            <div className="text-sm font-semibold text-brand-gray-400 italic">No script uploaded</div>
          )}
        </div>
        <div className="flex items-center space-x-6">
          {latestVersion && (
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase font-bold text-brand-gray-400">Inventory</div>
              <div className="text-xs font-bold text-brand-gray-900">{scenes.length} Scenes Indexed</div>
            </div>
          )}
          {canUpload && (
            <div className="relative group">
              <input
                type="file"
                accept=".pdf,.fdx,.fountain,.txt,.docx,.rtf"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                disabled={uploading}
                title="Upload Script"
              />
              <button 
                disabled={uploading}
                className={cn(
                  "px-6 py-2 rounded text-xs font-bold shadow-sm transition-all flex items-center gap-2",
                  !hasScript ? "bg-brand-blue text-white hover:bg-blue-700" : "bg-white border border-brand-gray-300 text-brand-gray-700 hover:bg-brand-gray-50"
                )}
              >
                {uploading ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                {uploading ? 'PROCESSING...' : (!hasScript ? 'UPLOAD SCRIPT' : 'RE-PARSE SCRIPT')}
              </button>
            </div>
          )}
        </div>
      </div>

      {!hasScript && !uploading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-20 text-center bg-brand-bg">
          <div className="w-24 h-24 bg-white border border-brand-gray-100 rounded-3xl shadow-xl flex items-center justify-center mb-8">
            <Plus size={48} className="text-brand-blue" />
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-brand-gray-900 mb-4 italic">No script uploaded</h2>
          <p className="text-sm text-brand-gray-500 max-w-md mb-10 leading-relaxed font-sans">
            Start your production by uploading a screenplay file (.pdf, .fdx, .fountain, .docx). We'll automatically identify scenes, locations, and characters for you.
          </p>
          <div className="relative group scale-125">
            <input
              type="file"
              accept=".pdf,.fdx,.fountain,.txt,.docx,.rtf"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer z-10"
              disabled={uploading}
            />
            <button className="bg-brand-gray-900 text-white px-10 py-4 rounded text-sm font-bold uppercase tracking-widest shadow-2xl hover:bg-brand-blue transition-all flex items-center gap-3">
              <Upload size={18} />
              Begin Script Import
            </button>
          </div>
          {error && <div className="mt-8 text-red-500 text-xs font-bold bg-red-50 px-4 py-2 rounded border border-red-100">{error}</div>}
        </div>
      ) : uploading ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-brand-bg">
          <div className="relative w-20 h-20 mb-8">
            <div className="absolute inset-0 border-4 border-brand-blue/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-t-brand-blue rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <FileUp size={32} className="text-brand-blue" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-brand-gray-900 mb-2 italic">Analyzing Screenplay</h3>
          <div className="flex flex-col items-center gap-2">
            {debugSteps.map((step, idx) => (
              <p key={idx} className={cn("text-[10px] uppercase font-bold tracking-widest", idx === debugSteps.length - 1 ? "text-brand-blue animate-pulse" : "text-brand-gray-400")}>
                {step}
              </p>
            ))}
          </div>
        </div>
      ) : hasScript && scenes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-20 text-center bg-red-50/30">
          <div className="w-24 h-24 bg-white border border-red-100 rounded-3xl shadow-xl flex items-center justify-center mb-8">
            <AlertCircle size={48} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-gray-900 mb-2 italic">Script uploaded but parsing failed</h2>
          <p className="text-sm text-brand-gray-500 max-w-md mb-8 leading-relaxed font-sans italic">
            {latestVersion?.fileName} was uploaded successfully, but we couldn't detect any standard scene headings (e.g., INT. KITCHEN - DAY).
          </p>
          <div className="flex gap-4">
             <div className="relative group">
              <input
                type="file"
                accept=".fdx,.fountain,.txt,.docx"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                disabled={uploading}
              />
              <button className="bg-brand-gray-900 text-white px-8 py-3 rounded text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-brand-blue transition-all flex items-center gap-3">
                <FileUp size={16} />
                Try another format
              </button>
            </div>
          </div>
          {error && <div className="mt-6 text-red-600 text-[10px] font-bold uppercase tracking-widest bg-white border border-red-100 px-4 py-2 rounded">{error}</div>}
        </div>
      ) : (
        <>
          {/* Quick Stats */}
          <section className="flex border-b border-brand-gray-200 divide-x divide-brand-gray-100 bg-white">
            <StatItem label="Parsed Scenes" value={scenes.length.toString()} />
            <StatItem label="Est. Shooting" value="12 Days" />
            <StatItem label="Script Status" value={latestVersion?.status === 'ready' ? "Ready" : "Syncing"} />
            <StatItem label="Active Version" value={latestVersion ? `v${latestVersion.version.toFixed(1)}` : "1.0"} />
          </section>

          {/* Split View Content */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
            {/* Mobile Scene Selector */}
            <div className="md:hidden p-4 border-b border-brand-gray-200 bg-brand-gray-50 shrink-0">
               <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest">Active Scene</label>
               <select 
                 value={selectedScene?.id || ''}
                 onChange={(e) => setSelectedScene(scenes.find(s => s.id === e.target.value) || null)}
                 className="w-full text-sm font-bold p-3 border border-brand-gray-300 rounded bg-white"
               >
                 {filteredScenes.map(s => (
                   <option key={s.id} value={s.id}>SCENE {s.number}: {s.location}</option>
                 ))}
               </select>
            </div>

            {/* Left Sidebar: Scene List - Hidden on Mobile */}
            <div className="hidden md:flex w-80 border-r border-brand-gray-200 bg-white flex-col shrink-0">
              <div className="p-4 border-b border-brand-gray-100 bg-brand-gray-50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray-400" size={14} />
                  <input 
                    type="text" 
                    placeholder="Search scenes..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full text-xs pl-9 pr-3 py-2 border border-brand-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-blue transition-all"
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {filteredScenes.length === 0 ? (
                  <div className="p-8 text-center text-xs text-brand-gray-400 italic">No scenes found matching that criteria</div>
                ) : (
                  filteredScenes.map((scene) => (
                    <button
                      key={scene.id}
                      onClick={() => setSelectedScene(scene)}
                      className={cn(
                        "w-full p-4 border-b border-brand-gray-100 border-l-4 text-left transition-all group",
                        selectedScene?.id === scene.id 
                          ? "border-brand-blue bg-blue-50" 
                          : "border-transparent hover:border-brand-gray-50 hover:border-l-brand-gray-200"
                      )}
                    >
                      <div className="flex justify-between text-[10px] font-bold mb-1">
                        <span className={cn(selectedScene?.id === scene.id ? "text-brand-blue" : "text-brand-gray-400 group-hover:text-brand-gray-600")}>SCENE {scene.number}</span> 
                        <span className="text-brand-gray-500 uppercase">{scene.intExt}</span>
                      </div>
                      <div className={cn("text-sm transition-colors truncate", selectedScene?.id === scene.id ? "font-bold text-brand-gray-900" : "font-medium text-brand-gray-600")}>
                        {scene.location}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right Detail Panel: Scene View */}
            <div className="flex-1 bg-white flex flex-col p-4 md:p-8 overflow-y-auto pb-24 md:pb-8">
              {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 text-xs flex items-center gap-2 rounded italic"><AlertCircle size={14} />{error}</div>}
              
              {selectedScene ? (
                <motion.div
                  key={selectedScene.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-4xl w-full"
                >
                  <div className="flex flex-col md:flex-row justify-between items-start mb-6 md:mb-8 gap-4">
                    <div>
                      <h2 className="text-xl md:text-3xl font-bold tracking-tight text-brand-gray-900 leading-tight">
                        {selectedScene.number}. {selectedScene.intExt} {selectedScene.location}
                      </h2>
                      <p className="text-[10px] text-brand-gray-500 italic mt-2 flex items-center gap-2 font-bold uppercase tracking-widest whitespace-nowrap">
                        <CheckCircle2 size={12} className="text-green-500" /> Screenplay AI Recognition Active
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <span className="px-3 py-1 bg-brand-gray-100 text-brand-gray-900 text-[10px] font-bold rounded uppercase ring-1 ring-brand-gray-200">
                        {selectedScene.intExt === 'INT' ? 'Interior' : 'Exterior'}
                      </span>
                      <span className={cn(
                        "px-3 py-1 text-white text-[10px] font-bold rounded uppercase",
                        selectedScene.dayNight === 'NIGHT' ? "bg-brand-gray-900" : "bg-brand-blue"
                      )}>
                        {selectedScene.dayNight}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-8 md:mb-10">
                    <Panel label="Scene Context">
                      <p className="text-xs md:text-sm text-brand-gray-600 italic">
                        {selectedScene.directorNotes || "No context specified via breakdown."}
                      </p>
                    </Panel>
                    <Panel label="Parsed Emotion">
                      <div className="flex items-center space-x-3 mt-1">
                        <div className="text-xl md:text-2xl font-bold text-brand-blue italic">{selectedScene.emotionalIntensity || 5}</div>
                        <div className="flex-1 h-2 bg-brand-gray-100 rounded-full overflow-hidden border border-brand-gray-200">
                          <div 
                            className="h-full bg-brand-blue transition-all" 
                            style={{ width: `${(selectedScene.emotionalIntensity || 5) * 10}%` }} 
                          />
                        </div>
                      </div>
                    </Panel>
                    <Panel label="Environment" className="sm:col-span-2 md:col-span-1">
                      <div className="text-xs md:text-sm font-bold text-brand-gray-800 flex items-center gap-2">
                        {selectedScene.dayNight === 'NIGHT' ? <Moon size={14} /> : <Sun size={14} />}
                        {selectedScene.dayNight} Lighting
                      </div>
                    </Panel>
                  </div>

                  <div className="border-t border-brand-gray-200 pt-6 md:pt-10">
                    <div className="bg-brand-gray-50/50 p-6 md:p-12 rounded border border-brand-gray-100 shadow-inner">
                      <div className="max-w-xl mx-auto font-mono text-sm space-y-6 text-brand-gray-800 break-words whitespace-pre-wrap leading-relaxed">
                        <p className="uppercase text-center text-brand-gray-300 font-bold tracking-[0.4em] mb-4 md:mb-8 text-[9px] md:text-[10px]">SCENE {selectedScene.number} - SCREENPLAY TEXT</p>
                        {selectedScene.synopsis || "No script content available for this scene."}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 md:mt-12 flex flex-col sm:flex-row justify-end gap-3 border-t border-brand-gray-100 pt-8 mb-20 md:mb-20">
                    <button className="w-full sm:w-auto px-6 py-3 border border-brand-gray-300 rounded text-xs font-bold hover:bg-brand-gray-50 transition-colors uppercase tracking-widest">Annotate Scene</button>
                    <button className="w-full sm:w-auto px-6 py-3 bg-brand-blue text-white rounded text-xs font-bold hover:bg-blue-700 transition-all uppercase tracking-widest shadow-sm">View Breakdown Detail</button>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-12">
                   <div className="w-16 h-16 bg-brand-gray-50 rounded-full flex items-center justify-center mb-6">
                    <FileText size={32} className="text-brand-gray-200" />
                   </div>
                   <h3 className="text-xl font-bold text-brand-gray-900 italic">Select a scene to view details</h3>
                   <p className="text-sm text-brand-gray-400 mt-2 font-sans italic">Scene data parsed from {latestVersion?.fileName}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="px-8 py-4 flex-1">
      <div className="text-[10px] text-brand-gray-400 uppercase font-bold tracking-widest">{label}</div>
      <div className="text-lg font-bold text-brand-gray-900 mt-1 italic tracking-tighter">{value}</div>
    </div>
  );
}

function Panel({ label, children, className }: { label: string, children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("bg-white p-5 border border-brand-gray-200 rounded shadow-sm hover:shadow-md transition-shadow", className)}>
      <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-3 tracking-widest border-b border-brand-gray-50 pb-2">{label}</label>
      {children}
    </div>
  );
}
