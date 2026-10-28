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

No GitHub Pages, os links **Administrar** abrem `admin.html?demo=1`, um modo de
demonstração com dados fictícios e somente visualização. Ele não acessa a API
nem os dados reais; para usar o painel conectado, hospede o backend Python em
um serviço compatível.

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
Contas administrativas adicionais são cadastradas pela tela **Configurações
master** e guardadas no banco com senha derivada (hash). Ao apagar o banco,
essas contas e a data de validade configurada também são apagadas.

No painel, o master pode definir a data até a qual os outros administradores
terão acesso. Após essa data, o painel e suas APIs ficam bloqueados para eles;
o site público continua disponível e o master ainda pode entrar para renovar
ou remover o limite.

Os cadastros são salvos em `rocha_fitness.db`, criado automaticamente na pasta
do projeto. Para escolher outro caminho para o banco, defina a variável de
ambiente `ROCHA_FITNESS_DATABASE` antes de iniciar o servidor.

As parcerias Escola Nacional Florestan Fernandes, Graal, Autopoli, ParaDouro
Batistela, Organização Campo das Oliveiras e Kautex são exibidas no site com
logotipos estáticos. A Gympass continua sendo carregada do banco de dados pela
API pública. O painel não oferece mais cadastro de parcerias.

As imagens de fundo das seções de planos e modalidades são do Unsplash:
[academia](https://unsplash.com/photos/photo-1534438327276-14e5300c3a48) e
[treino](https://unsplash.com/photos/photo-1571902943202-507ec2618e8f).
