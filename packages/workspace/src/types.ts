export interface WorkspaceField{key:string;name:string;fieldType:string;sortOrder:number;required:boolean;description?:string|null;constraints?:unknown;displayHints?:unknown}
export interface WorkspaceType{slug:string;name:string;description?:string|null;icon?:string|null;color?:string|null;folder?:string|null;system?:boolean;fields:WorkspaceField[]}
export interface WorkspaceEntity{id:string;typeSlug:string;slug:string;name:string;data:Record<string,unknown>;createdAt:string;updatedAt:string}
export interface WorkspaceSnapshot{root:WorkspaceEntity;entities:WorkspaceEntity[];types:WorkspaceType[]}
export interface WorkspaceSaveInput{name:string;data:Record<string,unknown>;expectedUpdatedAt:string}
export interface WorkspaceCreateInput{typeSlug:string;name:string;parent?:string;data?:Record<string,unknown>}
export interface WorkspaceTransport{save(entityId:string,input:WorkspaceSaveInput):Promise<WorkspaceEntity>;create(input:WorkspaceCreateInput):Promise<WorkspaceEntity>;remove(entityId:string,expectedUpdatedAt:string):Promise<void>}
