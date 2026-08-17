import { redirect } from 'next/navigation'

/**
 * 整合畫面已經搬到 `/`。保留這個 route 讓舊分頁與書籤不會 404 ——
 * 直接刪掉的話，開著 /selector 的分頁會一直重試而觸發 dev overlay 重載迴圈。
 */
export default function SelectorRedirect() {
  redirect('/')
}
