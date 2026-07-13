const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel } = require('/tmp/docx-local/node_modules/docx')
const fs = require('fs')

const vermelho = 'EE222B'
const preto = '1d1d1b'
const cinzaClaro = 'f5f5f5'
const cinzaBorda = 'e0e0e0'

const border = { style: BorderStyle.SINGLE, size: 1, color: cinzaBorda }
const borders = { top: border, bottom: border, left: border, right: border }

function titulo(text) {
  return new Paragraph({
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, color: vermelho, font: 'Arial' })]
  })
}

function subtitulo(text) {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22, color: preto, font: 'Arial' })]
  })
}

function paragrafo(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 20, font: 'Arial', color: '333333' })]
  })
}

function bullet(text, bold_prefix) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 480 },
    children: [
      new TextRun({ text: '• ', size: 20, font: 'Arial', color: vermelho }),
      bold_prefix
        ? new TextRun({ text: bold_prefix, size: 20, font: 'Arial', bold: true, color: preto })
        : null,
      new TextRun({ text: bold_prefix ? text : text, size: 20, font: 'Arial', color: '333333' }),
    ].filter(Boolean)
  })
}

function bulletNegrito(label, desc) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 480 },
    children: [
      new TextRun({ text: '• ', size: 20, font: 'Arial', color: vermelho }),
      new TextRun({ text: label, size: 20, font: 'Arial', bold: true, color: preto }),
      new TextRun({ text: ': ' + desc, size: 20, font: 'Arial', color: '333333' }),
    ]
  })
}

function divisor() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: cinzaBorda } },
    children: []
  })
}

function nota(text) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 480 },
    shading: { fill: 'FFF8E6', type: ShadingType.CLEAR },
    children: [new TextRun({ text: '⚠ ' + text, size: 18, font: 'Arial', color: '92400e', italics: true })]
  })
}

const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [

      // Cabeçalho
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: 'Buscador C&D — Cia de Talentos', bold: true, size: 32, font: 'Arial', color: preto })]
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: 'Resumo de ajustes implementados', size: 22, font: 'Arial', color: '888888' })]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: 'Junho 2026', size: 20, font: 'Arial', color: '888888' })]
      }),

      divisor(),

      // 1. Novos campos no formulário
      titulo('1. Novos campos no formulário de busca'),
      paragrafo('Três campos foram adicionados ao formulário para enriquecer o briefing e melhorar a qualidade das buscas:'),
      bulletNegrito('Temática', 'renomeado de "Skill / Tema" para alinhar com a nomenclatura interna da área.'),
      bulletNegrito('Idioma', 'campo de seleção com opções: Português, Inglês, Espanhol, Bilíngue PT/EN e Bilíngue PT/ES. Aparece sempre visível no formulário.'),
      bulletNegrito('Público-alvo', 'campo de texto livre para descrever o perfil dos participantes (ex: lideranças, jovens talentos, trainees).'),
      bulletNegrito('Localidade', 'campo de texto que aparece automaticamente somente quando a modalidade selecionada é Presencial ou Híbrido. Para modalidade Online, o campo permanece oculto. Quando visível, o preenchimento é obrigatório — a busca não avança sem ele.'),

      divisor(),

      // 2. Validação de datas
      titulo('2. Validação de datas'),
      paragrafo('O campo de data agora bloqueia automaticamente seleções inválidas, com mensagem explicativa para cada caso:'),
      bullet('Datas no passado'),
      bullet('Sábados e domingos'),
      bullet('Feriados nacionais de 2026 (Ano Novo, Carnaval, Sexta Santa, Tiradentes, Dia do Trabalho, Corpus Christi, Independência, Aparecida, Finados, Proclamação da República, Consciência Negra, Natal)'),
      bullet('Feriados estaduais de SP de 2026 (Aniversário de São Paulo – 25/jan, Revolução Constitucionalista – 09/jul)'),

      divisor(),

      // 3. Exibição de idioma e localidade nos resultados
      titulo('3. Idioma e localidade visíveis nos resultados'),
      paragrafo('Após a busca, o resultado de cada data exibe pills coloridas acima dos cards de consultoras:'),
      bulletNegrito('Pill azul', 'exibe o idioma informado (ex: 🌐 Inglês).'),
      bulletNegrito('Pill verde', 'exibe a localidade informada (ex: 📍 São Paulo – SP).'),
      paragrafo('Isso facilita a conferência visual antes de salvar a demanda no painel.'),

      divisor(),

      // 4. Correção do erro Cenário 17
      titulo('4. Correção do erro no botão "Enviar Convite" (Cenário 17)'),
      paragrafo('Foi corrigido um erro crítico que impedia o uso dos botões Enviar Convite, Aceitou e Recusou no painel de acompanhamento.'),
      paragrafo('Causa raiz: ao salvar uma demanda no painel, o sistema tentava atualizar um registro que ainda não existia no banco de dados — causando falha silenciosa. Ao tentar enviar o convite, o sistema não encontrava a consultora e retornava erro.'),
      paragrafo('Solução aplicada: a operação foi alterada de UPDATE para UPSERT, garantindo que o registro seja criado se não existir ou atualizado se já existir. O fluxo completo — salvar no painel → enviar convite → registrar aceite ou recusa — agora funciona corretamente.'),

      divisor(),

      // 5. Correção do upload CSV
      titulo('5. Correção do upload de arquivo CSV (Busca em Volume)'),
      bulletNegrito('Duplo clique eliminado', 'o botão de upload agora responde ao primeiro clique, sem necessidade de clicar duas vezes.'),
      bulletNegrito('Encoding corrigido', 'arquivos salvos pelo Excel em formato Windows-1252 (padrão do Excel em português) agora são lidos corretamente, sem caracteres quebrados como "InteligenAMÃ©ncia".'),

      divisor(),

      // 6. Template CSV atualizado
      titulo('6. Modelo CSV atualizado'),
      paragrafo('O arquivo de modelo para Busca em Volume foi atualizado com as novas colunas:'),
      bullet('tematica (substitui "skill")'),
      bullet('idioma'),
      bullet('publico_alvo'),
      bullet('localidade'),

      divisor(),

      // 7. Banco de dados
      titulo('7. Banco de dados'),
      paragrafo('Três novas colunas foram adicionadas à tabela de demandas no Supabase: idioma, publico_alvo e localidade. Todos os dados preenchidos nos formulários agora são persistidos corretamente.'),

      divisor(),

      // O que ficou para depois
      titulo('O que ficou fora do escopo desta rodada'),
      paragrafo('Os itens abaixo foram identificados nos testes mas deliberadamente deixados para uma próxima fase:'),
      bulletNegrito('Upload de PPTX', 'extração automática de dados do briefing via IA a partir de apresentações PowerPoint.'),
      bulletNegrito('Edição inline no CSV', 'possibilidade de corrigir linhas inválidas diretamente na tabela de resultados da Busca em Volume, sem precisar reabrir o arquivo.'),
      bulletNegrito('Matching por idioma e localidade', 'o algoritmo de matching ainda não filtra consultoras com base nesses critérios — os campos são armazenados e exibidos, mas não influenciam o ranqueamento.'),

    ]
  }]
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/sessions/happy-trusting-shannon/mnt/outputs/resumo-ajustes-buscador-ced.docx', buf)
  console.log('OK')
})
