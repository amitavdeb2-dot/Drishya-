import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp, orderBy, updateDoc, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { Project } from '../types';
import { Plus, Film, Clock, ChevronRight, MoreVertical, Trash2, Edit2, AlertTriangle, X, Loader2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OperationType, handleFirestoreError, cn } from '../lib/utils';

import { deleteProject } from '../services/projectService';

interface DashboardProps {
  user: any;
  onSelectProject: (project: Project) => void;
}

export default function Dashboard({ user, onSelectProject }: DashboardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<Project | null>(null);
  const [showRenameModal, setShowRenameModal] = useState<Project | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchProjects();
    
    // Close menus on click outside
    const handleClick = () => setActiveMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [user]);

  const duplicates = projects.reduce((acc, p) => {
    const isDuplicate = projects.filter(other => other.name.toLowerCase() === p.name.toLowerCase()).length > 1;
    if (isDuplicate) acc.add(p.name.toLowerCase());
    return acc;
  }, new Set<string>());

  const fetchProjects = async () => {
    try {
      // 0. Process any pending invitations for this email
      try {
        const inviteQ = query(
          collection(db, 'projectMembers'),
          where('email', '==', user.email.toLowerCase())
        );
        const inviteSnap = await getDocs(inviteQ);
        for (const d of inviteSnap.docs) {
          if (!d.data().userId) {
            // Create/Update the deterministic membership doc
            const membershipId = `${d.data().projectId}_${user.uid}`;
            await setDoc(doc(db, 'projectMembers', membershipId), {
              ...d.data(),
              userId: user.uid,
              joinedAt: serverTimestamp()
            });
            // Delete the temporary invitation doc if it was different
            if (d.id !== membershipId) {
              await deleteDoc(d.ref);
            }
          }
        }
      } catch (e) {
        console.error("Invite processing failed", e);
        handleFirestoreError(e, OperationType.LIST, 'projectMembers_invites', auth);
      }

      // 1. Fetch all collaborative links for this user
      let memberProjectIds: string[] = [];
      try {
        const memberQ = query(
          collection(db, 'projectMembers'),
          where('userId', '==', user.uid)
        );
        const memberSnapshot = await getDocs(memberQ);
        memberProjectIds = memberSnapshot.docs.map(d => d.data().projectId);
      } catch (e) {
        console.error("Member query failed", e);
        handleFirestoreError(e, OperationType.LIST, 'projectMembers_member', auth);
      }

      // 2. Fetch owned projects
      let ownedProjects: Project[] = [];
      try {
        const ownedQ = query(
          collection(db, 'projects'),
          where('ownerId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const ownedSnapshot = await getDocs(ownedQ);
        ownedProjects = ownedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      } catch (e) {
        console.error("Owned projects query failed", e);
        handleFirestoreError(e, OperationType.LIST, 'projects_owned', auth);
      }

      // 3. Fetch participated projects
      let participatedProjects: Project[] = [];
      if (memberProjectIds.length > 0) {
        const fetchedProjects = await Promise.all(
          memberProjectIds.map(async (projectId: string) => {
            try {
              const d = await getDoc(doc(db, 'projects', projectId));
              if (d.exists()) {
                return { id: d.id, ...d.data() } as Project;
              }
            } catch (e) {
              console.warn("Could not fetch participated project:", projectId, e);
            }
            return null;
          })
        );
        participatedProjects = fetchedProjects.filter((p): p is Project => p !== null);
      }

      // Merge results
      const allProjects = [...ownedProjects];
      participatedProjects.forEach(cp => {
        if (!allProjects.find(ap => ap.id === cp.id)) {
          allProjects.push(cp);
        }
      });

      setProjects(allProjects.sort((a, b) => {
        const aDate = a.createdAt?.seconds || Date.now() / 1000;
        const bDate = b.createdAt?.seconds || Date.now() / 1000;
        return bDate - aDate;
      }));
    } catch (error: any) {
      const path = error.path || 'unknown';
      handleFirestoreError(error, OperationType.LIST, path, auth);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const docRef = await addDoc(collection(db, 'projects'), {
        name: newName.trim(),
        description: '',
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });
      const newProj = { 
        id: docRef.id, 
        name: newName.trim(), 
        description: '',
        ownerId: user.uid, 
        createdAt: { seconds: Math.floor(Date.now() / 1000) } 
      } as Project;
      
      setProjects(prev => [newProj, ...prev]);
      setShowNewModal(false);
      setNewName('');
      onSelectProject(newProj);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects', auth);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showRenameModal || !renameValue.trim()) return;

    try {
      await updateDoc(doc(db, 'projects', showRenameModal.id), {
        name: renameValue.trim()
      });
      setProjects(projects.map(p => p.id === showRenameModal.id ? { ...p, name: renameValue.trim() } : p));
      setShowRenameModal(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects', auth);
    }
  };

  const handleDelete = async () => {
    if (!showDeleteModal) return;

    console.log("Deleting Project:", showDeleteModal.id);
    setIsDeleting(true);
    try {
      await deleteProject(showDeleteModal.id);
      setProjects(projects.filter(p => p.id !== showDeleteModal.id));
      setShowDeleteModal(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'projects', auth);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-brand-gray-200 pb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-brand-gray-900">Studio Dashboard</h1>
          <p className="text-brand-gray-500 font-sans uppercase tracking-[0.2em] text-[10px] font-bold mt-2">Active Production Cycle</p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="hidden md:flex items-center gap-2 bg-brand-blue text-white px-6 py-3 rounded text-xs font-bold shadow-sm hover:bg-blue-700 transition-all uppercase tracking-widest"
        >
          <Plus size={16} />
          Create New Production
        </button>
      </div>

      {/* Mobile Floating Action Button */}
      <div className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-[45] pointer-events-auto">
        <button
          onClick={() => setShowNewModal(true)}
          className="bg-brand-blue text-white px-8 py-4 rounded-full flex items-center gap-2 shadow-2xl active:scale-95 transition-all text-[10px] font-black uppercase tracking-[0.15em] ring-4 ring-white"
        >
          <Plus size={20} />
          Create
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] bg-white animate-pulse border border-brand-gray-200 rounded" />
          ))}
        </div>
      ) : projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {projects.map((project, idx) => {
            const isDuplicate = duplicates.has(project.name.toLowerCase());
            const isOwner = project.ownerId === user.uid;

            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={cn(
                  "group relative bg-white border rounded shadow-sm hover:shadow-md transition-all flex flex-col p-6 overflow-hidden",
                  isDuplicate ? "border-amber-200 bg-amber-50/10" : "border-brand-gray-200 hover:border-brand-blue"
                )}
              >
                <div 
                  className="absolute inset-0 z-0 cursor-pointer" 
                  onClick={() => onSelectProject(project)} 
                />
                
                <div className="flex-1 flex flex-col justify-between relative z-10 pointer-events-none">
                  <div className="flex items-center justify-between text-brand-gray-400 group-hover:text-brand-blue transition-colors font-mono text-[10px] tracking-widest uppercase mb-4 pointer-events-auto">
                    <div className="flex items-center gap-2">
                       <span>PRD-{idx + 101}</span>
                       {isDuplicate && <span className="text-amber-500 font-bold bg-amber-100 px-1.5 py-0.5 rounded">DUP</span>}
                    </div>
                    <div className="relative">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenu(activeMenu === project.id ? null : project.id);
                        }}
                        className="p-1 hover:bg-brand-gray-100 rounded-full transition-colors text-brand-gray-400 hover:text-brand-gray-900"
                      >
                        <MoreVertical size={16} />
                      </button>

                      {activeMenu === project.id && (
                        <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-brand-gray-200 rounded-lg shadow-xl py-1 z-[60]">
                           <button 
                             onClick={() => onSelectProject(project)}
                             className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-brand-gray-50 flex items-center gap-2"
                           >
                             <Film size={14} /> Open
                           </button>
                           {isOwner && (
                             <>
                               <button 
                                 onClick={() => {
                                   setShowRenameModal(project);
                                   setRenameValue(project.name);
                                 }}
                                 className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-brand-gray-50 flex items-center gap-2"
                               >
                                 <Edit2 size={14} /> Rename
                               </button>
                               <button 
                                 onClick={() => {
                                   setShowDeleteModal(project);
                                 }}
                                 className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-red-50 text-red-600 flex items-center gap-2 border-t border-brand-gray-100"
                               >
                                 <Trash2 size={14} /> Delete 
                               </button>
                             </>
                           )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="pointer-events-none">
                     <h3 className="text-xl font-bold text-brand-gray-900 group-hover:text-brand-blue transition-colors leading-tight mb-4">{project.name}</h3>
                     <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-tighter">
                        <div className="flex items-center gap-1.5 text-brand-gray-500">
                          <Clock size={12} />
                          <span>{new Date(project.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</span>
                        </div>
                        <div className="text-brand-blue opacity-0 group-hover:opacity-100 transition-opacity">
                          View production &rarr;
                        </div>
                     </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border-2 border-dashed border-brand-gray-200 rounded-lg h-64 flex flex-col items-center justify-center text-brand-gray-400 italic">
          <Film size={32} className="mb-4 opacity-20" />
          <p>No active productions. Create one to begin.</p>
        </div>
      )}

      {/* Modals UI */}
      <AnimatePresence>
        {showNewModal && (
          <div className="fixed inset-0 bg-brand-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-brand-gray-200 rounded p-10 max-w-lg w-full shadow-2xl relative"
            >
              <h2 className="text-2xl font-bold tracking-tight mb-6 italic">Start New Production</h2>
              <form onSubmit={handleCreateProject} className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-brand-gray-400 mb-2">Project Title</label>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Ghum Nai"
                    className="w-full bg-brand-gray-50 border border-brand-gray-200 px-4 py-3 rounded font-sans text-sm focus:outline-none focus:ring-1 focus:ring-brand-blue transition-all"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowNewModal(false)}
                    className="flex-1 px-6 py-3 border border-brand-gray-200 text-[10px] font-black uppercase tracking-widest hover:bg-brand-gray-50 transition-colors rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating || !newName.trim()}
                    className="flex-1 px-6 py-3 bg-brand-blue text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all rounded shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isCreating && <Loader2 className="animate-spin" size={14} />}
                    {isCreating ? 'Creating...' : 'Create Project'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showRenameModal && (
          <div className="fixed inset-0 bg-brand-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
             <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-brand-gray-200 rounded p-10 max-w-lg w-full shadow-2xl"
            >
              <h2 className="text-2xl font-bold tracking-tight mb-6 italic">Rename Production</h2>
              <form onSubmit={handleRename} className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-brand-gray-400 mb-2">New Title</label>
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full bg-brand-gray-50 border border-brand-gray-200 px-4 py-3 rounded font-sans text-sm focus:outline-none focus:ring-1 focus:ring-brand-blue transition-all"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRenameModal(null)}
                    className="flex-1 px-6 py-3 border border-brand-gray-200 text-[10px] font-black uppercase tracking-widest hover:bg-brand-gray-50 transition-colors rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-brand-blue text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all rounded shadow-lg"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showDeleteModal && (
          <div className="fixed inset-0 bg-brand-gray-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border-2 border-red-100 rounded-3xl p-10 max-w-sm w-full shadow-2xl relative text-center"
            >
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-8 mx-auto text-red-500">
                <AlertTriangle size={32} />
              </div>
              
              <h2 className="text-2xl font-bold tracking-tight mb-2 italic">Delete Production?</h2>
              <p className="text-brand-gray-400 text-[10px] font-bold uppercase tracking-widest mb-8 leading-relaxed">
                This will remove all scenes, storyboards, and schedules. <span className="text-red-500 block font-black mt-1">This action cannot be undone.</span>
              </p>

              <div className="flex flex-col gap-3">
                <button
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="w-full px-6 py-4 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all rounded-xl shadow-lg flex items-center justify-center gap-2"
                >
                  {isDeleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                  {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  disabled={isDeleting}
                  onClick={() => setShowDeleteModal(null)}
                  className="w-full px-6 py-4 border border-brand-gray-200 text-[10px] font-black uppercase tracking-widest hover:bg-brand-gray-50 transition-colors rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
