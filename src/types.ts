export enum IntExt {
  INT = 'INT',
  EXT = 'EXT',
  INT_EXT = 'INT/EXT'
}

export enum DayNight {
  DAY = 'DAY',
  NIGHT = 'NIGHT',
  DUSK = 'DUSK',
  DAWN = 'DAWN'
}

export enum Priority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: any;
}

export enum SceneStatus {
  NOT_STARTED = 'not-started',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed'
}

export interface Scene {
  id: string;
  projectId: string;
  ownerId: string;
  number: string;
  title?: string;
  intExt: IntExt | string;
  location: string;
  dayNight: DayNight | string;
  synopsis?: string;
  cast?: string[];
  props?: string[];
  wardrobe?: string[];
  notes?: string;
  directorNotes?: string;
  emotionalIntensity?: number;
  characterMentalState?: string;
  priority?: 'MUST' | 'SHOULD' | 'MAYBE';
  estimatedDuration?: number;
  pageCount?: number;
  order: number;
  status?: SceneStatus | string;
  logistics?: string;
  production_notes?: string;
  design_notes?: string;
  sound_notes?: string;
  lighting_notes?: string;
  availability_notes?: string;
}

export enum ProductionRole {
  DIRECTOR = 'Director',
  AD = 'Assistant Director',
  PM = 'Production Manager',
  DOP = 'Cinematographer',
  ART = 'Art Director',
  SOUND = 'Sound Recordist',
  GAFFER = 'Lighting / Gaffer',
  ACTOR = 'Actor'
}

export interface Collaborator {
  id: string;
  projectId: string;
  email: string;
  userId?: string;
  role: ProductionRole;
  invitedAt: any;
  joinedAt?: any;
}

export interface StoryboardFrame {
  id: string;
  sceneId: string;
  projectId: string;
  ownerId: string;
  imageUrl: string;
  title: string;
  description?: string;
  shotType?: string;
  cameraMovement?: string;
  cameraNotes?: string;
  artNotes?: string;
  technicalSpecs?: string;
  completed?: boolean;
  order: number;
}

export interface Shot {
  id: string;
  sceneId: string;
  projectId: string;
  ownerId: string;
  type: string;
  description: string;
  priority: Priority;
  duration?: string;
  completed: boolean;
  order: number;
}

export interface StripboardItem {
  id: string;
  projectId: string;
  ownerId: string;
  sceneId: string;
  shootDay: number;
  order: number;
}

export interface ScriptVersion {
  id?: string;
  projectId: string;
  ownerId: string;
  fileName: string;
  uploadDate: string;
  version: number;
  status: 'processing' | 'ready' | 'error';
  sceneCount?: number;
}
