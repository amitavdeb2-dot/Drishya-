import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { ProductionRole, Scene } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ROLE_CONFIG = {
  [ProductionRole.DIRECTOR]: {
    capabilities: [
      "upload_script",
      "edit_script",
      "edit_storyboard",
      "edit_schedule",
      "manage_team",
      "shoot_mode",
      "delete_project"
    ],
    modules: ['script', 'breakdown', 'storyboard', 'stripboard', 'schedule', 'callsheet', 'shoot', 'projectMembers'],
    fields: {
      storyboard: ['title', 'shotType', 'cameraMovement', 'cameraNotes', 'artNotes', 'technicalSpecs', 'completed'],
      stripboard: ['order', 'dayNight', 'intExt', 'location'],
      breakdown: ['intExt', 'location', 'dayNight', 'synopsis', 'cast', 'props', 'wardrobe', 'notes'],
      script: ['structure']
    }
  },
  [ProductionRole.AD]: {
    capabilities: [
      "edit_schedule",
      "shoot_mode",
      "update_progress",
      "manage_stripboard"
    ],
    modules: ['breakdown', 'storyboard', 'stripboard', 'schedule', 'callsheet', 'shoot'],
    fields: {
      storyboard: ['completed'],
      stripboard: ['order', 'dayNight', 'intExt', 'location'],
      breakdown: ['intExt', 'location', 'dayNight', 'synopsis', 'cast', 'props', 'wardrobe', 'notes'],
      script: []
    }
  },
  [ProductionRole.PM]: {
    capabilities: [
      "edit_schedule",
      "manage_logistics",
      "manage_team"
    ],
    modules: ['breakdown', 'schedule', 'callsheet', 'projectMembers'],
    fields: {
      storyboard: [],
      stripboard: ['order'],
      breakdown: ['location', 'notes', 'logistics', 'production_notes'],
      script: []
    }
  },
  [ProductionRole.DOP]: {
    capabilities: [
      "view_script",
      "edit_shotlist",
      "edit_camera_specs"
    ],
    modules: ['breakdown', 'storyboard', 'shoot'],
    fields: {
      storyboard: ['title', 'shotType', 'cameraMovement', 'cameraNotes', 'technicalSpecs'],
      stripboard: [],
      breakdown: ['notes'],
      script: []
    }
  },
  [ProductionRole.ART]: {
    capabilities: [
      "view_script",
      "edit_design_notes"
    ],
    modules: ['breakdown', 'storyboard'],
    fields: {
      storyboard: ['title', 'artNotes'],
      stripboard: [],
      breakdown: ['props', 'wardrobe', 'design_notes', 'notes'],
      script: []
    }
  },
  [ProductionRole.SOUND]: {
    capabilities: [
      "view_script",
      "add_sound_notes"
    ],
    modules: ['breakdown', 'shoot'],
    fields: {
      storyboard: [],
      stripboard: [],
      breakdown: ['sound_notes', 'notes'],
      script: []
    }
  },
  [ProductionRole.GAFFER]: {
    capabilities: [
      "view_script",
      "add_lighting_notes"
    ],
    modules: ['breakdown', 'shoot'],
    fields: {
      storyboard: [],
      stripboard: [],
      breakdown: ['lighting_notes', 'notes'],
      script: []
    }
  },
  [ProductionRole.ACTOR]: {
    capabilities: [
      "view_assigned_scenes",
      "report_availability"
    ],
    modules: ['breakdown'],
    fields: {
      storyboard: [],
      stripboard: [],
      breakdown: ['availability_notes'],
      script: []
    }
  }
};

export const PERMISSIONS: Record<string, string[]> = Object.entries(ROLE_CONFIG).reduce((acc, [role, config]) => {
  acc[role] = config.capabilities;
  return acc;
}, {} as Record<string, string[]>);

export function hasPermission(userRole: ProductionRole | string | undefined, action: string) {
  if (!userRole || userRole === ProductionRole.DIRECTOR) return true;
  return PERMISSIONS[userRole]?.includes(action) || false;
}

export function hasModuleAccess(role: ProductionRole | string | undefined, moduleName: string): boolean {
  if (!role || role === ProductionRole.DIRECTOR) return true;
  const rolePermissions = ROLE_CONFIG[role as ProductionRole];
  if (!rolePermissions) return true; 
  return rolePermissions.modules.includes(moduleName);
}

export function hasFieldAccess(role: ProductionRole | string | undefined, moduleName: string, fieldName: string): boolean {
  if (!role || role === ProductionRole.DIRECTOR) return true;
  const rolePermissions = ROLE_CONFIG[role as ProductionRole];
  if (!rolePermissions) return true;
  return rolePermissions.fields[moduleName as keyof typeof rolePermissions.fields]?.includes(fieldName) || false;
}

export function groupScenes(scenes: Scene[]) {
  const groups: Record<string, { location: string; time: string; scenes: Scene[] }> = {};

  scenes.forEach(scene => {
    const location = scene.location || "UNSORTED";
    const time = (scene.dayNight || "DAY") as string;
    const key = `${location}__${time}`;

    if (!groups[key]) {
      groups[key] = {
        location,
        time,
        scenes: []
      };
    }

    groups[key].scenes.push(scene);
  });

  return Object.values(groups);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, auth: any) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider: any) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
