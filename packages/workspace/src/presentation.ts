import type { WorkspaceEntity, WorkspaceEntityPresentation, WorkspaceField, WorkspacePresentationField, WorkspacePresentationVariant, WorkspaceType } from './types'

const summaryKeys=['summary','description','body','statement','notes','content','text','status']
const hiddenKeys=new Set(['parent','owner_id','owner_agent_id','owner_plugin','installation','confidential'])

function scalar(value:unknown):value is string|number|boolean{return typeof value==='string'||typeof value==='number'||typeof value==='boolean'}
function meaningful(value:unknown){return scalar(value)?String(value).trim().length>0:Array.isArray(value)?value.length>0:value!==null&&value!==undefined}
function displayField(field:WorkspaceField|undefined,key:string,value:unknown):WorkspacePresentationField{return{key,name:field?.name||key.replaceAll('_',' '),value,fieldType:field?.fieldType||typeof value}}
function summary(entity:WorkspaceEntity,type?:WorkspaceType){
  for(const key of summaryKeys){const value=entity.data[key];if(typeof value==='string'&&value.trim())return value.trim()}
  for(const field of type?.fields||[]){const value=entity.data[field.key];if(field.fieldType!=='entity_ref'&&typeof value==='string'&&value.trim())return value.trim()}
  return undefined
}

/**
 * Projects a canonical Workspace entity into a stable display model. Consumers own
 * placement and visual treatment; this function never copies or mutates entity data.
 */
export function presentWorkspaceEntity(entity:WorkspaceEntity,type?:WorkspaceType,variant:WorkspacePresentationVariant='card'):WorkspaceEntityPresentation{
  const description=summary(entity,type)
  const fields=(type?.fields||[])
    .filter(field=>!hiddenKeys.has(field.key)&&meaningful(entity.data[field.key])&&entity.data[field.key]!==description)
    .slice(0,variant==='detail'?12:variant==='table'?6:3)
    .map(field=>displayField(field,field.key,entity.data[field.key]))
  if(!type)for(const [key,value] of Object.entries(entity.data)){
    if(fields.length>=(variant==='detail'?12:3)||hiddenKeys.has(key)||!meaningful(value)||value===description)continue
    fields.push(displayField(undefined,key,value))
  }
  return{id:entity.id,typeSlug:entity.typeSlug,typeName:type?.name||entity.typeSlug,title:entity.name,eyebrow:type?.name||entity.typeSlug,summary:description,icon:type?.icon,color:type?.color,fields,variant}
}
