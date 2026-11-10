ARG ES_VERSION=8.19.0
FROM docker.elastic.co/elasticsearch/elasticsearch:${ES_VERSION}
ARG ES_VERSION
RUN bin/elasticsearch-plugin install --batch "https://get.infini.cloud/elasticsearch/analysis-ik/${ES_VERSION}"
COPY sky-chat.dic /usr/share/elasticsearch/config/analysis-ik/sky-chat.dic
RUN sed -i 's#<entry key="ext_dict"></entry>#<entry key="ext_dict">sky-chat.dic</entry>#' /usr/share/elasticsearch/config/analysis-ik/IKAnalyzer.cfg.xml
