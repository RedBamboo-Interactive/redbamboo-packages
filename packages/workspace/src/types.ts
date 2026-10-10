export interface WorkspaceField{key:string;name:string;fieldType:string;sortOrder:number;required:boolean;description?:string|null;constraints?:unknown;displayHints?:unknown}
export interface WorkspaceType{slug:string;name:string;description?:string|null;icon?:string|null;color?:string|null;folder?:string|null;system?:boolean;fields:WorkspaceField[]}
export interface WorkspaceEntity{id:string;typeSlug:string;slug:string;name:string;data:Record<string,unknown>;createdAt:string;updatedAt:string}
export type WorkspacePresentationVariant='compact'|'card'|'timeline'|'detail'|'table'
export interface WorkspacePresentationField{key:string;name:string;value:unknown;fieldType:string}
export interface WorkspaceEntityPresentation{id:string;typeSlug:string;typeName:string;title:string;eyebrow:string;summary?:string;icon?:string|null;color?:string|null;fields:WorkspacePresentationField[];variant:WorkspacePresentationVariant}
export interface WorkspaceSnapshot{root:WorkspaceEntity;entities:WorkspaceEntity[];types:WorkspaceType[]}
export interface WorkspaceListInput{typeSlugs:string[];query?:string;cursor?:string|null;limit?:number}
export interface WorkspaceEntityPage{items:WorkspaceEntity[];total:number;nextCursor?:string|null}
export interface WorkspaceSaveInput{name:string;data:Record<string,unknown>;expectedUpdatedAt:string}
export interface WorkspaceCreateInput{typeSlug:string;name:string;parent?:string;data?:Record<string,unknown>}
export interface WorkspaceTransport{list(input:WorkspaceListInput):Promise<WorkspaceEntityPage>;save(entityId:string,input:WorkspaceSaveInput):Promise<WorkspaceEntity>;create(input:WorkspaceCreateInput):Promise<WorkspaceEntity>;remove(entityId:string,expectedUpdatedAt:string):Promise<void>}
export interface WorkspaceMessages{
 pages:string;system:string;searchResults:string;recordsCouldNotLoad:string;loading:string;noSearchResults:string;noRecords:string;loadMore:(loaded:number,total:number)=>string;
 workspaceContents:string;searchPlaceholder:string;searchLabel:string;newRecord:string;backToWorkspace:string;saved:string;recordCouldNotSave:string;deleteConfirm:(name:string)=>string;
 recordCouldNotDelete:string;recordTitle:string;noEditableFields:string;chooseRecord:string;typeHasNoFields:string;saving:string;saveChanges:string;unsavedChanges:string;allChangesSaved:string;delete:string;
 select:string;none:string;newWorkspaceRecord:string;close:string;type:string;name:string;location:string;cancel:string;creating:string;create:string;
}
