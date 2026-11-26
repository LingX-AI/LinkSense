import type { Locale } from "@linksense/shared";

type WebSiteToolMessages = {
  "webSiteTool.confirmPublish": string;
  "webSiteTool.confirmUpdate": string;
  "webSiteTool.confirmDelete": string;
  "webSiteTool.emptyDescription": string;
  "webSiteTool.decision": string;
  "webSiteTool.deleteDecision": string;
  "webSiteTool.approvePublish": string;
  "webSiteTool.approveUpdate": string;
  "webSiteTool.approveDelete": string;
  "webSiteTool.reject": string;
};

export const webSiteToolMessages = {
  "zh-CN": {
    "webSiteTool.confirmPublish": "请确认公开发布此站点。任何拿到链接的人都可以访问。\n\n- **站点名称** {{name}}\n- **简介** {{description}}\n- **访问地址** {{url}}\n- **来源任务** {{task}}\n- **网页文件** {{file}}",
    "webSiteTool.confirmUpdate": "请确认发布新版本。访客会在此站点的现有链接上看到新版内容。\n\n- **站点名称** {{name}}\n- **访问地址** {{url}}\n- **来源任务** {{task}}\n- **新网页文件** {{file}}",
    "webSiteTool.confirmDelete": "请确认是否永久删除此站点。删除后，站点及全部发布版本将被移除，站点地址将被释放。\n\n- **站点名称** {{name}}\n- **站点地址** {{url}}",
    "webSiteTool.emptyDescription": "未填写",
    "webSiteTool.decision": "是否发布",
    "webSiteTool.deleteDecision": "是否删除",
    "webSiteTool.approvePublish": "确认发布",
    "webSiteTool.approveUpdate": "发布新版本",
    "webSiteTool.approveDelete": "确认删除",
    "webSiteTool.reject": "取消",
  },
  "en-US": {
    "webSiteTool.confirmPublish": "Confirm that you want to publish this site. Anyone with the link can open it.\n\n- **Site name** {{name}}\n- **Description** {{description}}\n- **Address** {{url}}\n- **Source task** {{task}}\n- **Webpage file** {{file}}",
    "webSiteTool.confirmUpdate": "Confirm that you want to publish a new version. Visitors will see the new content at the site's current address.\n\n- **Site name** {{name}}\n- **Address** {{url}}\n- **Source task** {{task}}\n- **New webpage file** {{file}}",
    "webSiteTool.confirmDelete": "Confirm permanent deletion of this site. Deleting it removes all published versions and frees its address.\n\n- **Site name** {{name}}\n- **Address** {{url}}",
    "webSiteTool.emptyDescription": "None",
    "webSiteTool.decision": "Publication decision",
    "webSiteTool.deleteDecision": "Delete this site?",
    "webSiteTool.approvePublish": "Publish site",
    "webSiteTool.approveUpdate": "Publish new version",
    "webSiteTool.approveDelete": "Confirm deletion",
    "webSiteTool.reject": "Cancel",
  },
  "es-ES": {
    "webSiteTool.confirmPublish": "Confirma que quieres publicar este sitio. Cualquier persona con el enlace podrá abrirlo.\n\n- **Nombre del sitio** {{name}}\n- **Descripción** {{description}}\n- **Dirección** {{url}}\n- **Tarea de origen** {{task}}\n- **Archivo de la página** {{file}}",
    "webSiteTool.confirmUpdate": "Confirma que quieres publicar una nueva versión. Los visitantes verán el nuevo contenido en la dirección actual del sitio.\n\n- **Nombre del sitio** {{name}}\n- **Dirección** {{url}}\n- **Tarea de origen** {{task}}\n- **Nuevo archivo de la página** {{file}}",
    "webSiteTool.confirmDelete": "Confirma que quieres eliminar este sitio de forma permanente. Se eliminarán todas sus versiones publicadas y se liberará su dirección.\n\n- **Nombre del sitio** {{name}}\n- **Dirección** {{url}}",
    "webSiteTool.emptyDescription": "Sin descripción",
    "webSiteTool.decision": "Decisión de publicación",
    "webSiteTool.deleteDecision": "¿Eliminar este sitio?",
    "webSiteTool.approvePublish": "Publicar sitio",
    "webSiteTool.approveUpdate": "Publicar nueva versión",
    "webSiteTool.approveDelete": "Confirmar eliminación",
    "webSiteTool.reject": "Cancelar",
  },
  "pt-BR": {
    "webSiteTool.confirmPublish": "Confirme a publicação deste site. Qualquer pessoa com o link poderá acessá-lo.\n\n- **Nome do site** {{name}}\n- **Descrição** {{description}}\n- **Endereço** {{url}}\n- **Tarefa de origem** {{task}}\n- **Arquivo da página** {{file}}",
    "webSiteTool.confirmUpdate": "Confirme a publicação de uma nova versão. Os visitantes verão o conteúdo atualizado no endereço atual do site.\n\n- **Nome do site** {{name}}\n- **Endereço** {{url}}\n- **Tarefa de origem** {{task}}\n- **Novo arquivo da página** {{file}}",
    "webSiteTool.confirmDelete": "Confirme a exclusão permanente deste site. Todas as versões publicadas serão excluídas e o endereço do site ficará disponível.\n\n- **Nome do site** {{name}}\n- **Endereço** {{url}}",
    "webSiteTool.emptyDescription": "Sem descrição",
    "webSiteTool.decision": "Decisão de publicação",
    "webSiteTool.deleteDecision": "Excluir este site?",
    "webSiteTool.approvePublish": "Publicar site",
    "webSiteTool.approveUpdate": "Publicar nova versão",
    "webSiteTool.approveDelete": "Confirmar exclusão",
    "webSiteTool.reject": "Cancelar",
  },
  "fr-FR": {
    "webSiteTool.confirmPublish": "Confirmez la publication de ce site. Toute personne disposant du lien pourra y accéder.\n\n- **Nom du site** {{name}}\n- **Description** {{description}}\n- **Adresse** {{url}}\n- **Tâche source** {{task}}\n- **Fichier de la page** {{file}}",
    "webSiteTool.confirmUpdate": "Confirmez la publication d’une nouvelle version. Les visiteurs verront le nouveau contenu à l’adresse actuelle du site.\n\n- **Nom du site** {{name}}\n- **Adresse** {{url}}\n- **Tâche source** {{task}}\n- **Nouveau fichier de la page** {{file}}",
    "webSiteTool.confirmDelete": "Confirmez la suppression définitive de ce site. Toutes les versions publiées seront supprimées et l’adresse du site sera libérée.\n\n- **Nom du site** {{name}}\n- **Adresse** {{url}}",
    "webSiteTool.emptyDescription": "Aucune description",
    "webSiteTool.decision": "Décision de publication",
    "webSiteTool.deleteDecision": "Supprimer ce site ?",
    "webSiteTool.approvePublish": "Publier le site",
    "webSiteTool.approveUpdate": "Publier la nouvelle version",
    "webSiteTool.approveDelete": "Confirmer la suppression",
    "webSiteTool.reject": "Annuler",
  },
  "ja-JP": {
    "webSiteTool.confirmPublish": "このサイトの公開を確認してください。リンクを知っている人は誰でもアクセスできます。\n\n- **サイト名** {{name}}\n- **説明** {{description}}\n- **公開アドレス** {{url}}\n- **元のタスク** {{task}}\n- **ウェブページのファイル** {{file}}",
    "webSiteTool.confirmUpdate": "新しいバージョンの公開を確認してください。訪問者には現在のサイトアドレスで新しい内容が表示されます。\n\n- **サイト名** {{name}}\n- **公開アドレス** {{url}}\n- **元のタスク** {{task}}\n- **新しいウェブページのファイル** {{file}}",
    "webSiteTool.confirmDelete": "このサイトを完全に削除するか確認してください。公開済みのすべてのバージョンが削除され、サイトのアドレスが解放されます。\n\n- **サイト名** {{name}}\n- **サイトアドレス** {{url}}",
    "webSiteTool.emptyDescription": "説明なし",
    "webSiteTool.decision": "公開するかどうか",
    "webSiteTool.deleteDecision": "このサイトを削除しますか？",
    "webSiteTool.approvePublish": "サイトを公開",
    "webSiteTool.approveUpdate": "新しいバージョンを公開",
    "webSiteTool.approveDelete": "削除を確定",
    "webSiteTool.reject": "キャンセル",
  },
} satisfies Record<Locale, WebSiteToolMessages>;
