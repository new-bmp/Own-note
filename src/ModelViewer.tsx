import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import type { CanvasNote, FolderEntry } from './model'
import { getAsset, downloadFile } from './storage'
import { extension } from '../shared/attachments.js'
import { RotateCcw, Download, Pause, Play } from 'lucide-react'
const noEntries:FolderEntry[]=[]
export function ModelViewer({blob,filename,entries=noEntries,resourcePath,settings}:{blob:Blob;filename:string;entries?:FolderEntry[];resourcePath?:string;settings?:CanvasNote['modelSettings']}){
  const host=useRef<HTMLDivElement>(null),actions=useRef<{reset:()=>void;wire:(v:boolean)=>void;rotate:(v:boolean)=>void;screenshot:()=>void;grid:(v:boolean)=>void}|undefined>(undefined)
  const [error,setError]=useState(''),[info,setInfo]=useState('正在读取 3D 模型…'),[wire,setWire]=useState(false),[rotate,setRotate]=useState(false),[grid,setGrid]=useState(true)
  const settingsRef=useRef(settings);settingsRef.current=settings
  useEffect(()=>{setWire(settings?.wireframe??false);setRotate(settings?.autoRotate??false);setGrid(settings?.grid??true);actions.current?.wire(settings?.wireframe??false);actions.current?.rotate(settings?.autoRotate??false);actions.current?.grid(settings?.grid??true)},[settings])
  useEffect(()=>{
    let active=true,renderer:THREE.WebGLRenderer|undefined,controls:OrbitControls|undefined,frame=0,observer:ResizeObserver|undefined,root:THREE.Object3D|undefined,scene:THREE.Scene|undefined,mixer:THREE.AnimationMixer|undefined
    const urls:string[]=[],resources=new Map<string,string>(),materials=new Set<THREE.Material>()
    function disposeObjects(object?:THREE.Object3D){object?.traverse(child=>{const mesh=child as THREE.Mesh;mesh.geometry?.dispose();if(mesh.material)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material]){for(const value of Object.values(mat))if(value instanceof THREE.Texture)value.dispose();mat.dispose()}})}
    setError('');setInfo('正在读取 3D 模型…');setWire(settingsRef.current?.wireframe??false);setRotate(settingsRef.current?.autoRotate??false);setGrid(settingsRef.current?.grid??true)
    void(async()=>{
      try{
        if(blob.size>100*1024*1024)throw new Error('模型超过 100 MB。')
        const related=entries.filter(e=>e.kind==='file'&&e.assetId&&e.path!==resourcePath)
        if(related.length>200)throw new Error('关联资源超过 200 个，请把模型与所需贴图放入单独文件夹。')
        let total=blob.size
        for(const entry of related){if(!active)return;const data=await getAsset(entry.assetId!);if(data){total+=data.size;if(total>150*1024*1024)throw new Error('模型与关联资源超过 150 MB。');const url=URL.createObjectURL(data);urls.push(url);resources.set(entry.path,url)}}
        if(!active)return
        const manager=new THREE.LoadingManager()
        const base=(resourcePath||filename).split('/').slice(0,-1).join('/')
        manager.setURLModifier(value=>{
          if(value.startsWith('data:')||urls.includes(value))return value
          if(/^(?:https?:|file:|\/\/)/i.test(value))throw new Error('模型中的远程资源未加载，请把贴图一同导入文件夹。')
          const decoded=decodeURIComponent(value).replaceAll('\\','/')
          const normalized=(`${base?base+'/':''}${decoded}`).split('/').reduce<string[]>((parts,p)=>{if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);return parts},[]).join('/')
          const found=resources.get(normalized)||resources.get(decoded)
          if(!found)throw new Error(`模型缺少关联资源：${decoded}。请导入包含贴图与缓冲区的文件夹。`)
          return found
        })
        const bytes=await blob.arrayBuffer(),ext=extension(filename)
        let animations:THREE.AnimationClip[]=[]
        if(ext==='glb'||ext==='gltf'){const gltf=await new GLTFLoader(manager).parseAsync(bytes,'');root=gltf.scene;animations=gltf.animations}
        else if(ext==='obj'){
          const text=new TextDecoder().decode(bytes),loader=new OBJLoader(manager)
          const mtl=text.match(/^mtllib\s+(.+)$/m)?.[1]?.trim()
          if(mtl){const key=base?base+'/'+mtl:mtl;const materialURL=resources.get(key)||resources.get(mtl);if(!materialURL)throw new Error(`缺少材质 ${mtl}，请连同 OBJ 导入文件夹。`);const text=await fetch(materialURL).then(r=>r.text());const directory=mtl.includes('/')?mtl.slice(0,mtl.lastIndexOf('/')+1):'';const material=new MTLLoader(manager).parse(text,directory);material.preload();loader.setMaterials(material)}
          root=loader.parse(text)
        } else if(ext==='stl'||ext==='ply'){
          const geometry=ext==='stl'?new STLLoader().parse(bytes):new PLYLoader().parse(bytes)
          geometry.computeVertexNormals();const material=new THREE.MeshStandardMaterial({color:'#93b8d4',side:THREE.DoubleSide,vertexColors:geometry.hasAttribute('color')})
          root=new THREE.Mesh(geometry,material)
        } else if(ext==='fbx'){root=new FBXLoader(manager).parse(bytes,'');animations=root.animations}
        else if(ext==='3mf')root=new ThreeMFLoader(manager).parse(bytes)
        else throw new Error('支持 GLB、glTF、OBJ、STL、PLY、FBX 和 3MF。')
        if(!active||!host.current)return
        scene=new THREE.Scene();scene.background=new THREE.Color('#edf1f7')
        const camera=new THREE.PerspectiveCamera(40,1,.01,10000)
        renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace
        host.current.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','可旋转缩放的 3D 模型')
        controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true
        scene.add(new THREE.HemisphereLight('#ffffff','#697580',2.6));const light=new THREE.DirectionalLight('#ffffff',3);light.position.set(4,7,5);scene.add(light)
        const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3())
        if(!Number.isFinite(size.length())||size.length()===0)throw new Error('模型没有可显示的几何体。')
        const scale=3/Math.max(size.x,size.y,size.z);root.position.sub(center);const normalized=new THREE.Group();normalized.add(root);normalized.scale.setScalar(scale);scene.add(normalized)
        const floor=new THREE.GridHelper(10,20,'#94a5ba','#d4dce7');floor.position.y=-size.y*scale/2-.01;scene.add(floor)
        let vertices=0,triangles=0
        root.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.geometry){vertices+=mesh.geometry.getAttribute('position')?.count||0;triangles+=(mesh.geometry.index?.count||mesh.geometry.getAttribute('position')?.count||0)/3}if(mesh.material)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(mat)})
        if(animations.length){mixer=new THREE.AnimationMixer(root);animations.forEach(clip=>mixer!.clipAction(clip).play())}
        const reset=()=>{camera.position.set(4,3,5);controls!.target.set(0,0,0);controls!.update()};reset()
        actions.current={reset,wire:v=>materials.forEach(m=>{if('wireframe'in m){(m as THREE.MeshStandardMaterial).wireframe=v;m.needsUpdate=true}}),rotate:v=>{controls!.autoRotate=v},grid:v=>{floor.visible=v},screenshot:()=>renderer!.domElement.toBlob(image=>{if(image)downloadFile(image,filename+'.png')})}
        actions.current.wire(settingsRef.current?.wireframe??false);actions.current.rotate(settingsRef.current?.autoRotate??false);actions.current.grid(settingsRef.current?.grid??true)
        observer=new ResizeObserver(()=>{if(!host.current||!renderer)return;const{width,height}=host.current.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix()});observer.observe(host.current)
        const clock=new THREE.Clock();function draw(){if(!active||!renderer||!scene)return;frame=requestAnimationFrame(draw);mixer?.update(clock.getDelta());controls!.update();renderer.render(scene,camera)}draw()
        setInfo(`${vertices.toLocaleString()} 顶点 · ${Math.round(triangles).toLocaleString()} 三角面${animations.length?' · '+animations.length+' 段动画':''} · 拖动旋转，滚轮缩放，右键平移`)
      }catch(e){if(active){setError(String(e));setInfo('模型未能显示，原始文件保留。')}}
      finally {if(!active){disposeObjects(scene||root);urls.forEach(url=>URL.revokeObjectURL(url))}}
    })()
    return()=>{active=false;cancelAnimationFrame(frame);observer?.disconnect();controls?.dispose();mixer?.stopAllAction();renderer?.dispose();renderer?.domElement.remove();disposeObjects(scene||root);urls.forEach(url=>URL.revokeObjectURL(url));actions.current=undefined}
  },[blob,filename,resourcePath,entries])
  return <section className="model-viewer" aria-label={`3D 查看器：${filename}`}><div className="model-viewport" ref={host}/><p className="lab-help">{info}</p>{error&&<p className="lab-error" role="alert">{error}</p>}<div className="lab-actions"><button onClick={()=>actions.current?.reset()}><RotateCcw size={14}/>重置视角</button><button aria-pressed={wire} onClick={()=>{setWire(!wire);actions.current?.wire(!wire)}}>线框</button><button aria-pressed={grid} onClick={()=>{setGrid(!grid);actions.current?.grid(!grid)}}>网格</button><button aria-pressed={rotate} onClick={()=>{setRotate(!rotate);actions.current?.rotate(!rotate)}}>{rotate?<Pause size={14}/>:<Play size={14}/>}自动旋转</button><button onClick={()=>actions.current?.screenshot()}><Download size={14}/>保存视图</button></div></section>
}
