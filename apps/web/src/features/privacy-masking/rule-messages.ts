import type { Locale } from "@linksense/shared"

type RuleMessages = {
  personalTitle: string
  personalDescription: string
  off: string
  mask: string
  block: string
  warn: string
  phoneRegion: string
  internationalPhone: string
  phoneRegionHint: string
  idCardHint: string
  bankCardHint: string
  customTitle: string
  customDescription: string
  addTemplate: string
  addRegex: string
  template: string
  regex: string
  name: string
  prefix: string
  digits: string
  pattern: string
  patternHint: string
  action: string
  remove: string
  invalidField: string
  invalidRegex: string
  invalidSettings: string
  previewInvalid: string
  previewBlocked: string
  previewHit: string
}

export const privacyMaskingRuleMessages = {
  "zh-CN": {
    personalTitle: "个人信息识别",
    personalDescription: "按类别开启。未启用的类别不会通过内置规则识别。",
    off: "关闭",
    mask: "替换并还原",
    block: "阻止发送",
    warn: "仅检测，不拦截",
    phoneRegion: "本地号码所属地区",
    internationalPhone: "仅识别带国际区号的号码",
    phoneRegionHint:
      "带 + 国际区号的号码始终可识别。选择地区后，也会匹配该地区的本地号码。",
    idCardHint: "识别中国大陆 18 位居民身份证号码，并检查日期和校验码。",
    bankCardHint:
      "匹配银行卡号等标签附近通过校验的卡号，不按长度拦截普通数字。",
    customTitle: "自定义规则",
    customDescription:
      "用格式模板识别业务编号，或用受限正则匹配更复杂的文本。最多 {{max}} 条。",
    addTemplate: "添加编号模板",
    addRegex: "添加正则规则",
    template: "编号模板",
    regex: "正则规则",
    name: "规则名称",
    prefix: "固定前缀",
    digits: "数字位数",
    pattern: "正则表达式",
    patternHint:
      "例如 CUS-[0-9]{6}。替换整段匹配；不支持环视、反向引用或匹配空字符串的表达式。",
    action: "命中动作",
    remove: "移除规则",
    invalidField: "请填写有效的值。",
    invalidRegex:
      "这个正则无效、使用了不支持的语法，或超出复杂度限制。请简化后重试。",
    invalidSettings: "请检查规则、词条和允许列表的格式及长度限制。",
    previewInvalid: "请先补全或修正草稿规则。",
    previewBlocked: "此文本命中拦截规则，不会发送给模型。",
    previewHit: "{{name}} · {{action}} ×{{count}}",
  },
  "en-US": {
    personalTitle: "Personal information",
    personalDescription:
      "Enable detection by category. Built-in rules skip categories that are off.",
    off: "Off",
    mask: "Replace and restore",
    block: "Block sending",
    warn: "Detect only",
    phoneRegion: "Region for local numbers",
    internationalPhone: "International numbers only",
    phoneRegionHint:
      "Numbers with a + country code are always eligible. Select a region to match local numbers too.",
    idCardHint:
      "Recognizes 18-character mainland China resident IDs with a valid date and check digit.",
    bankCardHint:
      "Matches card numbers that pass a checksum near a card label, not unlabeled numbers by length alone.",
    customTitle: "Custom rules",
    customDescription:
      "Use a template for business IDs, or a restricted regex for more complex text. Up to {{max}} rules.",
    addTemplate: "Add ID template",
    addRegex: "Add regex rule",
    template: "ID template",
    regex: "Regex rule",
    name: "Rule name",
    prefix: "Fixed prefix",
    digits: "Number of digits",
    pattern: "Regular expression",
    patternHint:
      "Example: CUS-[0-9]{6}. Replaces the full match. Lookarounds, backreferences, and expressions that match an empty string are not supported.",
    action: "On match",
    remove: "Remove rule",
    invalidField: "Enter a valid value.",
    invalidRegex:
      "This regex is invalid, uses unsupported syntax, or is too complex. Simplify it and try again.",
    invalidSettings:
      "Check the format and length of your rules, words, and allowed values.",
    previewInvalid: "Complete or correct the draft rules to preview them.",
    previewBlocked:
      "This text matches a blocking rule and won’t be sent to the model.",
    previewHit: "{{name}} · {{action}} ×{{count}}",
  },
  "es-ES": {
    personalTitle: "Información personal",
    personalDescription:
      "Activa la detección por categoría. Las reglas integradas omiten las categorías desactivadas.",
    off: "Desactivada",
    mask: "Sustituir y restaurar",
    block: "Bloquear el envío",
    warn: "Solo detectar",
    phoneRegion: "Región de los números locales",
    internationalPhone: "Solo números internacionales",
    phoneRegionHint:
      "Siempre se tienen en cuenta los números con prefijo internacional (+). Selecciona una región para incluir también los números locales.",
    idCardHint:
      "Detecta documentos de identidad de China continental de 18 caracteres con fecha y dígito de control válidos.",
    bankCardHint:
      "Detecta números de tarjeta junto a una etiqueta de tarjeta y con un dígito de control válido, no por su longitud solamente.",
    customTitle: "Reglas personalizadas",
    customDescription:
      "Usa una plantilla para identificadores o una expresión regular restringida para texto más complejo. Máximo {{max}} reglas.",
    addTemplate: "Añadir plantilla de identificador",
    addRegex: "Añadir expresión regular",
    template: "Plantilla de identificador",
    regex: "Regla de expresión regular",
    name: "Nombre de la regla",
    prefix: "Prefijo fijo",
    digits: "Número de dígitos",
    pattern: "Expresión regular",
    patternHint:
      "Ejemplo: CUS-[0-9]{6}. Sustituye toda la coincidencia. No admite aserciones de anticipación o retrospección, referencias inversas ni expresiones que coincidan con una cadena vacía.",
    action: "Acción al coincidir",
    remove: "Eliminar regla",
    invalidField: "Introduce un valor válido.",
    invalidRegex:
      "La expresión no es válida, usa una sintaxis no admitida o es demasiado compleja. Simplifícala y vuelve a intentarlo.",
    invalidSettings:
      "Revisa el formato y los límites de longitud de las reglas, las palabras y los valores permitidos.",
    previewInvalid:
      "Completa o corrige las reglas del borrador para previsualizarlas.",
    previewBlocked:
      "El texto coincide con una regla de bloqueo y no se enviará al modelo.",
    previewHit: "{{name}} · {{action}} ×{{count}}",
  },
  "pt-BR": {
    personalTitle: "Informações pessoais",
    personalDescription:
      "Ative a detecção por categoria. As regras integradas ignoram as categorias desativadas.",
    off: "Desativada",
    mask: "Substituir e restaurar",
    block: "Bloquear envio",
    warn: "Apenas detectar",
    phoneRegion: "Região dos números locais",
    internationalPhone: "Somente números internacionais",
    phoneRegionHint:
      "Números com código internacional (+) são sempre considerados. Selecione uma região para incluir também os números locais.",
    idCardHint:
      "Detecta números de identidade da China continental com 18 caracteres, data e dígito verificador válidos.",
    bankCardHint:
      "Detecta números de cartão com dígito verificador válido próximos de um rótulo de cartão, não apenas pelo comprimento.",
    customTitle: "Regras personalizadas",
    customDescription:
      "Use um modelo para identificadores ou uma expressão regular restrita para textos mais complexos. Até {{max}} regras.",
    addTemplate: "Adicionar modelo de identificador",
    addRegex: "Adicionar expressão regular",
    template: "Modelo de identificador",
    regex: "Regra de expressão regular",
    name: "Nome da regra",
    prefix: "Prefixo fixo",
    digits: "Quantidade de dígitos",
    pattern: "Expressão regular",
    patternHint:
      "Exemplo: CUS-[0-9]{6}. Substitui toda a correspondência. Não aceita lookahead, lookbehind, referências retroativas ou expressões que correspondam a uma string vazia.",
    action: "Ação ao detectar",
    remove: "Remover regra",
    invalidField: "Insira um valor válido.",
    invalidRegex:
      "A expressão é inválida, usa uma sintaxe incompatível ou é complexa demais. Simplifique-a e tente novamente.",
    invalidSettings:
      "Confira o formato e os limites de comprimento das regras, palavras e valores permitidos.",
    previewInvalid: "Preencha ou corrija as regras do rascunho para testá-las.",
    previewBlocked:
      "O texto corresponde a uma regra de bloqueio e não será enviado ao modelo.",
    previewHit: "{{name}} · {{action}} ×{{count}}",
  },
  "fr-FR": {
    personalTitle: "Informations personnelles",
    personalDescription:
      "Activez la détection par catégorie. Les règles intégrées ignorent les catégories désactivées.",
    off: "Désactivée",
    mask: "Remplacer et restaurer",
    block: "Bloquer l’envoi",
    warn: "Détecter uniquement",
    phoneRegion: "Région des numéros locaux",
    internationalPhone: "Numéros internationaux uniquement",
    phoneRegionHint:
      "Les numéros avec un indicatif international (+) sont toujours pris en compte. Sélectionnez une région pour inclure ses numéros locaux.",
    idCardHint:
      "Détecte les numéros d’identité de Chine continentale à 18 caractères dont la date et le caractère de contrôle sont valides.",
    bankCardHint:
      "Détecte les numéros valides près d’un libellé de carte, pas les nombres de même longueur sans ce contexte.",
    customTitle: "Règles personnalisées",
    customDescription:
      "Utilisez un modèle pour les identifiants ou une expression régulière restreinte pour les textes plus complexes. Jusqu’à {{max}} règles.",
    addTemplate: "Ajouter un modèle d’identifiant",
    addRegex: "Ajouter une expression régulière",
    template: "Modèle d’identifiant",
    regex: "Règle d’expression régulière",
    name: "Nom de la règle",
    prefix: "Préfixe fixe",
    digits: "Nombre de chiffres",
    pattern: "Expression régulière",
    patternHint:
      "Exemple : CUS-[0-9]{6}. Remplace toute la correspondance. Les assertions avant ou arrière, les références arrière et les expressions correspondant à une chaîne vide ne sont pas prises en charge.",
    action: "Action en cas de correspondance",
    remove: "Supprimer la règle",
    invalidField: "Saisissez une valeur valide.",
    invalidRegex:
      "L’expression est invalide, utilise une syntaxe non prise en charge ou est trop complexe. Simplifiez-la, puis réessayez.",
    invalidSettings:
      "Vérifiez le format et les limites de longueur des règles, des mots et des valeurs autorisées.",
    previewInvalid:
      "Complétez ou corrigez les règles du brouillon pour afficher l’aperçu.",
    previewBlocked:
      "Ce texte correspond à une règle de blocage et ne sera pas envoyé au modèle.",
    previewHit: "{{name}} · {{action}} ×{{count}}",
  },
  "ja-JP": {
    personalTitle: "個人情報の検出",
    personalDescription:
      "種類ごとに検出を有効にできます。オフの種類は組み込みルールでは検出しません。",
    off: "オフ",
    mask: "置換して復元",
    block: "送信をブロック",
    warn: "検出のみ",
    phoneRegion: "国内電話番号の地域",
    internationalPhone: "国番号付きの電話番号のみ",
    phoneRegionHint:
      "「+」から始まる国番号付きの電話番号は常に対象です。地域を選ぶと、その地域の国内番号も検出します。",
    idCardHint:
      "日付とチェック文字が有効な中国本土の18桁の居民身分証番号を検出します。",
    bankCardHint:
      "カード番号などのラベルの近くにあり、チェックデジットが有効な番号を検出します。桁数だけでは判定しません。",
    customTitle: "カスタムルール",
    customDescription:
      "業務用の識別子にはテンプレート、複雑なテキストには制限付きの正規表現を使えます。最大{{max}}件です。",
    addTemplate: "識別子テンプレートを追加",
    addRegex: "正規表現ルールを追加",
    template: "識別子テンプレート",
    regex: "正規表現ルール",
    name: "ルール名",
    prefix: "固定の接頭辞",
    digits: "数字の桁数",
    pattern: "正規表現",
    patternHint:
      "例: CUS-[0-9]{6}。一致した部分全体を置換します。先読み・後読み、後方参照、空文字列に一致する式には対応していません。",
    action: "一致した場合の動作",
    remove: "ルールを削除",
    invalidField: "有効な値を入力してください。",
    invalidRegex:
      "正規表現が無効か、未対応の構文が含まれているか、複雑すぎます。簡略化して再試行してください。",
    invalidSettings:
      "ルール、単語、許可する値の形式と文字数を確認してください。",
    previewInvalid:
      "プレビューするには、下書きのルールを入力または修正してください。",
    previewBlocked:
      "このテキストはブロックルールに一致したため、モデルに送信されません。",
    previewHit: "{{name}}・{{action}} ×{{count}}",
  },
} satisfies Record<Locale, RuleMessages>
