import React, { useState, useEffect } from 'react';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User } from './lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './lib/firebase';
import { LogIn, Film, FileText, Layout, Image as ImageIcon, Calendar, ClipboardList, List, Plus, LogOut, ChevronLeft, Home, Zap, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard from './components/Dashboard';
import ScriptModule from './components/ScriptModule';
import BreakdownModule from './components/BreakdownModule';
import StoryboardModule from './components/StoryboardModule';
import StripboardModule from './components/StripboardModule';
import ScheduleModule from './components/ScheduleModule';
import CallsheetModule from './components/CallsheetModule';
import ShootMode from './components/ShootMode';
import { Project, ProductionRole } from './types';
import { OperationType, handleFirestoreError, cn, hasModuleAccess } from './lib/utils';
import CollaboratorsModule from './components/CollaboratorsModule';

type View = 'dashboard' | 'script' | 'breakdown' | 'storyboard' | 'stripboard' | 'schedule' | 'callsheet' | 'shots' | 'shoot' | 'collaborators';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [userRole, setUserRole] = useState<ProductionRole | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    if (project.ownerId === user?.uid) {
      setUserRole(ProductionRole.DIRECTOR);
    } else {
      try {
        const q = query(
          collection(db, 'collaborators'),
          where('projectId', '==', project.id),
          where('userId', '==', user?.uid)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setUserRole(snap.docs[0].data().role as ProductionRole);
        } else {
          setUserRole(undefined); // Should not happen if they saw it in dashboard
        }
      } catch (e) {
         console.error("Error fetching role", e);
      }
    }
    setCurrentView('script');
  };

  const handleLogin = () => {
    signInWithPopup(auth, googleProvider)
      .then((result) => {
        console.log("SUCCESS:", result.user);
      })
      .catch((error) => {
        console.error("ERROR:", error);
      });
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-brand-bg">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Film className="w-12 h-12 text-brand-ink opacity-20" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-brand-bg p-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <Film className="w-16 h-16 mb-8 mx-auto text-brand-blue" />
          <h1 className="text-4xl mb-4 font-bold tracking-tight">Drishya</h1>
          <p className="text-brand-gray-500 mb-8 font-sans">
            Minimal, production-focused film management tool for modern creators.
          </p>
          <button
            onClick={handleLogin}
            className="flex items-center justify-center w-full gap-3 bg-brand-blue text-white px-6 py-4 rounded font-sans font-bold hover:bg-blue-700 transition-all uppercase tracking-widest text-xs shadow-sm"
          >
            <LogIn size={18} />
            Login with Google
          </button>
        </motion.div>
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'script':
        return selectedProject ? <ScriptModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'breakdown':
        return selectedProject ? <BreakdownModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'storyboard':
        return selectedProject ? <StoryboardModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'stripboard':
        return selectedProject ? <StripboardModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'schedule':
        return selectedProject ? <ScheduleModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'callsheet':
        return selectedProject ? <CallsheetModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'shoot':
        return selectedProject ? <ShootMode project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      case 'collaborators':
        return selectedProject ? <CollaboratorsModule project={selectedProject} userRole={userRole} /> : <Dashboard user={user} onSelectProject={handleSelectProject} />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-brand-gray-500/40 italic">
            Module coming soon...
          </div>
        );
    }
  };

  const menuItems = [
    { id: 'script', label: 'Script Module', icon: <FileText size={18} />, isItalic: true },
    { id: 'breakdown', label: 'Scene Breakdown', icon: <List size={18} /> },
    { id: 'storyboard', label: 'Storyboard', icon: <ImageIcon size={18} /> },
    { id: 'stripboard', label: 'Stripboard', icon: <Plus size={18} /> },
    { id: 'schedule', label: 'Shooting Schedule', icon: <Calendar size={18} /> },
    { id: 'callsheet', label: 'Call Sheet', icon: <ClipboardList size={18} /> },
    { id: 'shoot', label: 'Live Shoot Mode', icon: <Zap size={18} /> },
    { id: 'collaborators', label: 'Team & Roles', icon: <Users size={18} /> },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen bg-brand-bg overflow-hidden">
      {/* Sidebar Navigation - Hidden on Mobile */}
      <aside className="hidden md:flex w-64 border-r border-brand-gray-200 bg-white flex-col">
        <div className="p-6 border-b border-brand-gray-100">
          <h1 className="text-xl font-bold tracking-tight text-brand-blue">Drishya</h1>
          <p className="text-[10px] text-brand-gray-500 uppercase tracking-widest mt-1">Film Production Suite</p>
        </div>
        
        <nav className="flex-1 py-4 overflow-y-auto">
          <NavItem 
            active={currentView === 'dashboard'} 
            onClick={() => {
               setCurrentView('dashboard');
               setSelectedProject(null);
               setUserRole(undefined);
            }}
            icon={<Layout size={18} />} 
            label="Studio Dashboard" 
          />
          
          {selectedProject && (
            <>
              <div className="pt-4 pb-2 px-6">
                <p className="text-[10px] uppercase tracking-widest text-brand-gray-500 font-bold">Production</p>
              </div>
              {menuItems.filter(item => hasModuleAccess(userRole, item.id)).map(item => (
                <div key={item.id}>
                  <NavItem 
                    active={currentView === item.id} 
                    onClick={() => setCurrentView(item.id as View)}
                    icon={item.icon} 
                    label={item.label} 
                    isItalic={item.isItalic}
                  />
                </div>
              ))}
            </>
          )}
        </nav>

        {selectedProject && (
          <div className="p-6 border-t border-brand-gray-100 bg-brand-gray-50">
            <div className="text-[10px] font-bold text-brand-gray-500 uppercase mb-2">Project Context</div>
            <div className="text-sm font-bold text-brand-gray-900 truncate">{selectedProject.name}</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="text-[10px] bg-brand-blue/10 text-brand-blue px-2 py-0.5 rounded font-black uppercase tracking-tighter">
                {userRole}
              </div>
              <div className="text-[10px] text-brand-gray-500 truncate italic">
                {user.displayName}
              </div>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-brand-gray-100">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-brand-gray-500 hover:text-brand-gray-900 hover:bg-brand-gray-100 transition-colors rounded text-sm font-medium"
          >
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden pb-16 md:pb-0">
        <header className="h-16 bg-white border-b border-brand-gray-200 flex items-center justify-between px-4 md:px-8 shrink-0 z-40 sticky top-0">
          <div className="flex items-center space-x-3 md:space-x-4">
            <button 
              onClick={() => {
                setCurrentView('dashboard');
                setSelectedProject(null);
              }}
              className="md:hidden p-1 -ml-1 text-brand-gray-400 hover:text-brand-blue transition-colors"
            >
              <ChevronLeft size={24} />
            </button>
            <div 
              className="md:hidden cursor-pointer"
              onClick={() => {
                setCurrentView('dashboard');
                setSelectedProject(null);
              }}
            >
              <Film className="w-6 h-6 text-brand-blue" />
            </div>
            <div className="hidden sm:block text-xs md:text-sm text-brand-gray-500">
              {currentView === 'dashboard' ? 'Studio Dashboard' : 'Production'} &rarr; {currentView}
            </div>
            <div className="sm:hidden text-xs font-bold text-brand-gray-900 uppercase">
              {currentView}
            </div>
            {selectedProject && (
              <>
                <div className="h-4 w-px bg-brand-gray-200"></div>
                <div 
                  className="text-xs md:text-sm font-bold truncate max-w-[120px] md:max-w-none cursor-pointer hover:text-brand-blue"
                  onClick={() => {
                    setCurrentView('dashboard');
                    setSelectedProject(null);
                  }}
                >
                  {selectedProject.name}
                </div>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-3 md:gap-6">
             <div className="flex items-center gap-2 md:gap-3">
               <div className="text-right hidden md:block">
                 <div className="text-[10px] uppercase font-bold text-brand-gray-500">User</div>
                 <div className="text-xs font-bold text-brand-gray-900">{user.displayName}</div>
               </div>
               <div className="w-8 h-8 rounded bg-brand-gray-100 flex items-center justify-center text-xs font-bold text-brand-blue overflow-hidden shadow-inner">
                  {user.photoURL ? <img src={user.photoURL} alt={user.displayName || ''} referrerPolicy="no-referrer" /> : user.displayName?.[0]}
               </div>
               <button onClick={handleLogout} className="md:hidden p-2 text-brand-gray-400">
                 <LogOut size={18} />
               </button>
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden bg-brand-bg relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView + (selectedProject?.id || '')}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="h-full overflow-hidden"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mobile Bottom Navigation */}
        {selectedProject && (
          <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-brand-gray-200 flex items-center justify-around px-2 pb-safe z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] focus-within:z-50">
            <MobileNavItem 
              active={currentView === 'dashboard'} 
              onClick={() => {
                setCurrentView('dashboard');
                setSelectedProject(null);
              }}
              icon={<Home size={20} />} 
              label="Home" 
            />
            <MobileNavItem 
              active={currentView === 'script'} 
              onClick={() => setCurrentView('script')}
              icon={<FileText size={20} />} 
              label="Script" 
            />
            <MobileNavItem 
              active={currentView === 'breakdown'} 
              onClick={() => setCurrentView('breakdown')}
              icon={<List size={20} />} 
              label="B-Down" 
            />
            <MobileNavItem 
              active={currentView === 'storyboard'} 
              onClick={() => setCurrentView('storyboard')}
              icon={<ImageIcon size={20} />} 
              label="Boards" 
            />
            <MobileNavItem 
              active={currentView === 'stripboard'} 
              onClick={() => setCurrentView('stripboard')}
              icon={<Layout size={20} />} 
              label="Strips" 
            />
            <MobileNavItem 
              active={currentView === 'shoot'} 
              onClick={() => setCurrentView('shoot')}
              icon={<Zap size={20} />} 
              label="Shoot" 
            />
          </nav>
        )}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, isItalic }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void, isItalic?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 w-full px-6 py-3 transition-all",
        active 
          ? "bg-blue-50 text-brand-blue border-r-4 border-brand-blue" 
          : "text-brand-gray-500 hover:bg-brand-gray-50"
      )}
    >
      <span className={cn(active ? "text-brand-blue" : "text-brand-gray-500")}>
        {icon}
      </span>
      <span className={cn("text-sm font-medium", active && "font-semibold", isItalic && "italic")}>{label}</span>
    </button>
  );
}

function MobileNavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 transition-all flex-1 h-full",
        active ? "text-brand-blue" : "text-brand-gray-400"
      )}
    >
      <div className={cn("p-1 rounded-lg transition-all", active && "bg-blue-50")}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}
