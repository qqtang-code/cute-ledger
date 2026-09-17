// 单测全局准备：Node 里没有 IndexedDB，用内存实现顶上（只用于单测，E2E 用真浏览器的真库）
import 'fake-indexeddb/auto'