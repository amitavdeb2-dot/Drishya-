import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Project, ProductionRole, Collaborator } from '../types';
import { Users, Plus, Mail, Shield, Trash2, Loader2, CheckCircle2, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OperationType, handleFirestoreError, cn, hasPermission } from '../lib/utils';

interface CollaboratorsModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function CollaboratorsModule({ project, userRole }: CollaboratorsModuleProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProductionRole>(ProductionRole.AD);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canManageTeam = hasPermission(userRole, 'manage_team');

  const copyInviteLink = () => {
    const url = `${window.location.origin}?project=${project.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    fetchCollaborators();
  }, [project]);

  const fetchCollaborators = async () => {
    try {
      const q = query(
        collection(db, 'collaborators'),
        where('projectId', '==', project.id)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Collaborator));
      setCollaborators(data);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'collaborators', auth);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || inviting) return;
    setError(null);
    setInviting(true);

    try {
      // Check if already invited
      const existing = collaborators.find(c => c.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        setError('Colleague already invited.');
        setInviting(false);
        return;
      }

      // 1. Add to Firestore
      await addDoc(collection(db, 'collaborators'), {
        projectId: project.id,
        email: email.toLowerCase(),
        role: selectedRole,
        invitedBy: auth.currentUser?.uid,
        invitedAt: serverTimestamp()
      });

      // 2. Send Invitation Email via our Server (Brevo)
      const inviteLink = `${window.location.origin}?project=${project.id}`;
      try {
        const response = await fetch('/api/send-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toEmail: email.toLowerCase(),
            projectName: project.name,
            inviteLink: inviteLink,
            roleName: selectedRole
          })
        });
        
        if (!response.ok) {
          const errData = await response.json();
          console.error("Email API Error:", errData.error);
        }
      } catch (err) {
        console.error("Failed to trigger invite email:", err);
      }

      setEmail('');
      fetchCollaborators();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'collaborators', auth);
    } finally {
      setInviting(false);
    }
  };

  const removeCollaborator = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'collaborators', id));
      setCollaborators(collaborators.filter(c => c.id !== id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'collaborators', auth);
    }
  };

  if (loading) return <div className="p-10 flex items-center justify-center italic text-brand-gray-500 uppercase tracking-widest text-[10px]">Loading team data...</div>;

  return (
    <div className="h-full bg-brand-bg md:p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8 p-6 md:p-0">
        <header>
           <h1 className="text-3xl font-black tracking-tight text-brand-gray-900 uppercase italic">Team & Permissions</h1>
           <p className="text-[10px] text-brand-gray-500 font-bold uppercase tracking-[0.2em] mt-2">Manage production hierarchy and access control</p>
        </header>

        {canManageTeam && (
          <section className="bg-white border border-brand-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <h2 className="text-sm font-black uppercase tracking-widest text-brand-gray-900 flex items-center gap-2">
                <Plus size={16} className="text-brand-blue" />
                Invite Production Staff
              </h2>
              <button
                onClick={copyInviteLink}
                className="flex items-center gap-2 px-4 py-2 bg-brand-gray-50 border border-brand-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-brand-gray-600 hover:bg-brand-blue/5 hover:text-brand-blue hover:border-brand-blue/20 transition-all active:scale-95"
              >
                {copied ? (
                  <>
                    <Check size={14} />
                    Link Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copy Invite Link
                  </>
                )}
              </button>
            </div>
            
            <form onSubmit={handleInvite} className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-6">
                <label className="block text-[10px] font-bold uppercase text-brand-gray-400 mb-2 tracking-widest">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray-300" size={16} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cinematographer@studio.com"
                    className="w-full bg-brand-gray-50 border border-brand-gray-200 pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20 transition-all font-medium"
                    required
                  />
                </div>
              </div>
              <div className="md:col-span-4">
                <label className="block text-[10px] font-bold uppercase text-brand-gray-400 mb-2 tracking-widest">Production Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as ProductionRole)}
                  className="w-full bg-brand-gray-50 border border-brand-gray-200 px-4 py-3 rounded-xl text-sm focus:outline-none appearance-none font-bold text-brand-gray-900"
                >
                  {Object.values(ProductionRole).map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex items-end">
                <button
                  type="submit"
                  disabled={inviting}
                  className="w-full bg-brand-gray-900 text-white font-black uppercase tracking-widest text-[10px] py-4 rounded-xl hover:bg-brand-blue transition-all disabled:opacity-50 shadow-lg active:scale-95"
                >
                  {inviting ? <Loader2 className="animate-spin mx-auto" size={16} /> : 'Invite'}
                </button>
              </div>
            </form>
            {error && <p className="mt-4 text-xs font-bold text-red-500 uppercase tracking-widest">{error}</p>}
          </section>
        )}

        <section className="space-y-4">
           <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-gray-400 px-2 flex items-center gap-2">
             <Users size={12} />
             Active Production Team ({collaborators.length + 1})
           </h3>
           
           <div className="grid gap-3">
              {/* Owner always shown first */}
              <div className="bg-white border border-brand-blue/20 p-5 rounded-2xl flex items-center justify-between shadow-sm relative overflow-hidden group">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-blue"></div>
                 <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue border-2 border-brand-blue/5">
                       <Shield size={20} />
                    </div>
                    <div>
                       <div className="text-sm font-black text-brand-gray-900">Project Director</div>
                       <div className="text-[10px] font-bold text-brand-gray-400 uppercase tracking-widest mt-0.5">Primary Owner</div>
                    </div>
                 </div>
                 <div className="px-3 py-1 bg-brand-blue text-white text-[9px] font-black uppercase tracking-widest rounded-full shadow-md">
                    OWNER
                 </div>
              </div>

              {collaborators.map((collab) => (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={collab.id}
                  className="bg-white border border-brand-gray-100 p-5 rounded-2xl flex items-center justify-between shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center border-2",
                      collab.userId ? "bg-green-50 text-green-600 border-green-500/10" : "bg-brand-gray-50 text-brand-gray-400 border-brand-gray-200"
                    )}>
                       {collab.userId ? <CheckCircle2 size={20} /> : <Mail size={20} />}
                    </div>
                    <div>
                       <div className="text-sm font-black text-brand-gray-900">{collab.email}</div>
                       <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-bold text-brand-gray-400 uppercase tracking-widest">{collab.role}</span>
                          <span className="w-1 h-1 bg-brand-gray-200 rounded-full"></span>
                          <span className="text-[9px] font-medium text-brand-gray-400 italic">
                            {collab.userId ? 'Joined Team' : 'Invitation Pending'}
                          </span>
                       </div>
                    </div>
                  </div>
                  
                  {canManageTeam && (
                    <button
                      onClick={() => removeCollaborator(collab.id)}
                      className="p-3 text-brand-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </motion.div>
              ))}
           </div>
        </section>

        <section className="bg-brand-gray-50 border border-brand-gray-200 rounded-2xl p-6">
           <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-gray-900 mb-4">Role Privileges Reference</h4>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <RoleCard role={ProductionRole.AD} color="blue" description="Full stripboard control, updating shot completion, and live shoot access." />
              <RoleCard role={ProductionRole.DOP} color="indigo" description="Modify shot types, camera movements, and technical camera specs." />
              <RoleCard role={ProductionRole.ART} color="orange" description="Specialized art direction notes and set/prop considerations." />
           </div>
        </section>
      </div>
    </div>
  );
}

function RoleCard({ role, color, description }: { role: string, color: string, description: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200'
  };

  return (
    <div className={cn("p-4 rounded-xl border", colors[color])}>
       <div className="text-[10px] font-black uppercase tracking-widest mb-1">{role}</div>
       <p className="text-[11px] leading-relaxed opacity-80">{description}</p>
    </div>
  );
}
