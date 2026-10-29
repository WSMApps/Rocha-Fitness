# Rocha Fitness Academia

Site público e painel administrativo da Rocha Fitness com cadastros, parcerias
fixas, calendários, planos e finanças. O servidor e a persistência dos dados
são em Python, com SQLite; não são necessárias dependências externas.

## Executar

1. Instale o Python 3.9 ou superior.
2. Na pasta do projeto, execute `python app.py` (no Windows, também pode usar
   `py app.py`).
3. Abra <http://127.0.0.1:8000> no navegador.
4. A página inicial mostra os planos, modalidades, horário, localização e
   empresas parceiras. Acesse <http://127.0.0.1:8000/admin> para abrir o painel.

Com as credenciais públicas configuradas em `supabase-config.js`, o GitHub Pages
abre o painel conectado ao Supabase. Sem essa configuração, os links
**Administrar** abrem `admin.html?demo=1`, um modo de demonstração com dados
fictícios e somente visualização. Quando o backend Python está disponível no
mesmo domínio, os links abrem `/admin`, que apresenta a tela de login ligada ao
banco local ou PostgreSQL.

Na primeira execução, o servidor solicita o usuário master e a senha sem
exibi-la:

```powershell
py app.py
```

As credenciais master ficam no banco, com a senha protegida por hash. Se as
variáveis antigas `ROCHA_FITNESS_MASTER_USERNAME` e
`ROCHA_FITNESS_MASTER_PASSWORD` ainda estiverem definidas e não houver uma conta
master no banco, elas serão usadas para inicializá-la; depois, podem ser
removidas do ambiente. Apagar o banco também apaga a conta master. Se as
variáveis antigas ainda estiverem definidas, serão usadas novamente; caso
contrário, o servidor solicitará novas credenciais na próxima execução.
No backend Python, contas administrativas adicionais são cadastradas pela tela
**Configurações master** e guardadas no banco com senha derivada (hash). No
acesso direto pelo Supabase, crie cada conta em **Authentication** e vincule-a
a `public.profiles` com o papel `admin` ou `master`; a tela master lista os
administradores, mas não cria contas Auth. Ao apagar o banco, as contas locais
e a data de validade configurada também são apagadas.

No painel, o master pode definir a data até a qual os outros administradores
terão acesso. Após essa data, o painel e suas APIs ficam bloqueados para eles;
o site público continua disponível e o master ainda pode entrar para renovar
ou remover o limite.

Os cadastros são salvos em `rocha_fitness.db`, criado automaticamente na pasta
do projeto. Para escolher outro caminho para o banco, defina a variável de
ambiente `ROCHA_FITNESS_DATABASE` antes de iniciar o servidor.

As parcerias Escola Nacional Florestan Fernandes, Graal, Autopoli, ParaDouro
Batistela, Organização Campo das Oliveiras e Kautex são exibidas no site com
logotipos estáticos. A Gympass é carregada pela API pública do backend Python ou
pela tabela pública restrita do Supabase, conforme a implantação. O painel não
oferece mais cadastro de parcerias.

As imagens de fundo das seções de planos e modalidades são do Unsplash:
[academia](https://unsplash.com/photos/photo-1534438327276-14e5300c3a48) e
[treino](https://unsplash.com/photos/photo-1571902943202-507ec2618e8f).

## Testar com PostgreSQL do Supabase

Este modo é opcional: sem `ROCHA_FITNESS_DATABASE_URL`, a aplicação continua
usando SQLite como antes. O backend conecta diretamente ao PostgreSQL; nenhuma
chave Supabase é usada pelo frontend.

1. No Supabase de teste, abra **SQL Editor**, crie uma consulta e execute todo o
   conteúdo de `migrations/001_initial_schema.sql`. Isso cria apenas as tabelas
   vazias; não migra nem apaga dados do SQLite.
2. Instale o driver PostgreSQL:

   ```powershell
   py -3 -m pip install -r requirements.txt
   ```

3. No painel do Supabase, copie a URI de conexão PostgreSQL. No PowerShell,
   informe-a sem exibi-la no histórico/terminal e inicie o servidor:

   ```powershell
   $secureUrl = Read-Host "URI PostgreSQL do Supabase" -AsSecureString
   $env:ROCHA_FITNESS_DATABASE_URL = (New-Object System.Net.NetworkCredential("", $secureUrl)).Password
   py -3 app.py
   ```

   Na primeira execução, o servidor solicitará a criação do usuário master; a
   senha digitada não será exibida. Abra `http://127.0.0.1:8000/admin` e use
   somente dados fictícios no teste.

4. Ao encerrar o servidor, remova a variável do terminal:

   ```powershell
   Remove-Item Env:ROCHA_FITNESS_DATABASE_URL
   ```

Não compartilhe nem salve a URI, senha ou credenciais no repositório. Esta etapa
não copia dados locais para o Supabase. A conexão PostgreSQL exige SSL e usa
consultas preparadas compatíveis com o pooler em modo de transação.

## Publicar no GitHub Pages com Supabase Auth

Este modo permite que o site estático e o painel funcionem sem um servidor
Python. As credenciais usadas pelo navegador são a URL do projeto e a chave
pública `anon`/publishable; elas não são segredos. **Nunca** coloque a chave
`service_role`, a URI do PostgreSQL ou senhas no arquivo de configuração ou no
GitHub.

1. No Supabase, abra **SQL Editor** e execute primeiro
   `migrations/001_initial_schema.sql` se ainda não criou as tabelas. Em seguida,
   execute `migrations/002_supabase_auth_rls.sql`. A segunda migração ativa RLS,
   cria os perfis de acesso e publica apenas os campos da parceria Gympass. Ela
   não importa os registros do SQLite.
2. No Supabase, desative o cadastro público de usuários (sign-ups). Crie os
   administradores manualmente em **Authentication → Users** com e-mail e senha.
   Não use a conta antiga de login por nome de usuário: o Supabase Auth exige
   e-mail e senha.
3. Para cada usuário criado, copie seu UUID e e-mail do Supabase Auth. No SQL
   Editor, vincule o UUID ao perfil autorizado. Exemplo para o usuário master:

   ```sql
   INSERT INTO public.profiles (user_id, email, role)
   VALUES ('UUID-DO-USUARIO', 'email-do-master', 'master');
   ```

   Para os demais administradores, use o papel `admin`. Não habilite edição de
   `profiles` pelo navegador; a migração permite consulta, mas não escrita pelos
   usuários da aplicação.
4. Copie a **Project URL** e a chave **publishable** (ou `anon`, se o painel
   ainda apresentar esse nome) do Supabase para `url` e `anonKey` em
   `supabase-config.js`. A chave pública ficará visível no site por definição;
   o controle de acesso depende das políticas RLS da migração 002.
5. Em **Authentication → URL Configuration**, defina o domínio publicado do
   GitHub Pages como **Site URL** e adicione-o à lista de redirecionamentos
   autorizados, se exibida. Mantenha desabilitado o cadastro público.
6. Publique o repositório no GitHub Pages e teste login, leitura e operações de
   cadastro/edição/exclusão com uma conta autorizada. Teste também uma conta sem
   perfil: ela não deve acessar os dados. Nenhum dado local é migrado por esses
   passos; importe os registros somente após conferir e planejar a migração.

A conta `master` pode alterar a data de validade do painel. A tabela `records`
contém dados de alunos, incluindo telefone, vencimento e potencialmente
aniversário; as políticas permitem acesso apenas a perfis vinculados e também
bloqueiam os administradores após o vencimento. O master mantém o acesso para
renovar a data. Revise as permissões e mantenha apenas os dados pessoais
necessários. A parceria pública é servida por `public_partners`, que não contém
esses registros administrativos.
